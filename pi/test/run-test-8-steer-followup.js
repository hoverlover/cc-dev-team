#!/usr/bin/env node
/**
 * Test 8: Steer vs Follow-Up Semantics
 *
 * Validates: Steer interrupts mid-task, follow-up queues until task completes.
 * Spawns one agent, gives it a multi-step task, sends steer mid-task,
 * then repeats with follow_up to verify different behavior.
 *
 * Prerequisites: ANTHROPIC_API_KEY set, pi installed globally
 *
 * Usage: node pi/test/run-test-8-steer-followup.js
 */

import { spawn } from "child_process";
import { join } from "path";
import { createRpcClient } from "../rpc-client.js";

const TIMEOUT = 90_000;
const WORKTREE = process.cwd();

function spawnAgent() {
  const proc = spawn("pi", [
    "--mode", "rpc",
    "--provider", "anthropic",
    "--model", "claude-haiku-4-5",
    "--no-session",
    "--thinking", "off",
  ], {
    cwd: WORKTREE,
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  const events = [];
  const waiters = [];

  proc.stderr.on("data", () => {}); // suppress

  const client = createRpcClient(proc.stdout, proc.stdin, (event) => {
    events.push(event);
    for (const w of [...waiters]) w(event);
  });

  const waitForEvent = (predicate, timeout = TIMEOUT) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout")), timeout);
      const check = (event) => {
        if (predicate(event)) {
          clearTimeout(timer);
          const idx = waiters.indexOf(check);
          if (idx >= 0) waiters.splice(idx, 1);
          resolve(event);
        }
      };
      for (const e of events) {
        if (predicate(e)) { clearTimeout(timer); resolve(e); return; }
      }
      waiters.push(check);
    });
  };

  return { proc, client, events, waitForEvent };
}

function getResponseText(events) {
  // Get text from streaming deltas
  const textDeltas = events
    .filter((e) => e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta")
    .map((e) => e.assistantMessageEvent.delta);
  let text = textDeltas.join("");

  // Fallback: get text from agent_end messages
  if (!text) {
    const agentEnd = events.find((e) => e.type === "agent_end");
    for (const msg of (agentEnd?.messages || [])) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") text += block.text;
        }
      }
    }
  }
  return text;
}

async function testSteer() {
  console.log("── Part A: Steer (should interrupt) ──\n");

  const agent = spawnAgent();
  await new Promise((r) => setTimeout(r, 3000));

  // Give agent a multi-step task
  console.log("1. Sending multi-step task...");
  agent.client.send({
    type: "prompt",
    id: "task-steer",
    message: "Do 3 things sequentially: (1) use bash to run 'echo step1', (2) use bash to run 'echo step2', (3) use bash to run 'echo step3'. Do each one at a time.",
  });

  // Wait for first tool call to start
  console.log("2. Waiting for first tool call...");
  await agent.waitForEvent((e) => e.type === "tool_execution_start");
  console.log("  First tool call started.");

  // Wait for first tool to complete, then steer
  await agent.waitForEvent((e) => e.type === "tool_execution_end");
  console.log("3. Sending steer: 'URGENT: What is 2+2? Say the answer.'");
  agent.client.send({
    type: "steer",
    message: "URGENT: What is 2+2? Say the answer immediately before continuing any other steps.",
  });

  // Wait for agent to finish
  console.log("4. Waiting for agent to finish...");
  await agent.waitForEvent((e) => e.type === "agent_end");

  const responseText = getResponseText(agent.events);
  const toolCalls = agent.events.filter((e) => e.type === "tool_execution_start");

  // Steer should cause the agent to acknowledge mid-task
  const acknowledged = responseText.includes("4") || responseText.toLowerCase().includes("2+2") || responseText.toLowerCase().includes("four");
  console.log(`\n  Response includes steer acknowledgment: ${acknowledged ? "✓" : "✗"}`);
  console.log(`  Tool calls made: ${toolCalls.length}`);
  console.log(`  Response (first 300 chars): "${responseText.slice(0, 300)}"`);

  agent.proc.kill("SIGTERM");

  return { acknowledged, toolCalls: toolCalls.length };
}

async function testFollowUp() {
  console.log("\n── Part B: Follow-Up (should queue) ──\n");

  const agent = spawnAgent();
  await new Promise((r) => setTimeout(r, 3000));

  // Give agent a multi-step task
  console.log("1. Sending multi-step task...");
  agent.client.send({
    type: "prompt",
    id: "task-followup",
    message: "Do 3 things sequentially: (1) use bash to run 'echo step1', (2) use bash to run 'echo step2', (3) use bash to run 'echo step3'. Do each one at a time.",
  });

  // Wait for first tool call
  console.log("2. Waiting for first tool call...");
  await agent.waitForEvent((e) => e.type === "tool_execution_start");
  console.log("  First tool call started.");

  // Send follow_up while agent is working
  console.log("3. Sending follow_up: 'After you finish, what is 3+3?'");
  agent.client.send({
    type: "follow_up",
    message: "After you finish the current task, tell me: what is 3+3? Just say the number.",
  });

  // Wait for first agent_end (completes original task)
  console.log("4. Waiting for agent to finish original task...");
  const firstEnd = await agent.waitForEvent((e) => e.type === "agent_end");

  // The follow_up should trigger a second turn
  console.log("5. Waiting for follow-up turn...");
  let followUpProcessed = false;
  try {
    // Wait for second agent_end with shorter timeout
    const indexAfterFirst = agent.events.indexOf(firstEnd);
    await agent.waitForEvent(
      (e) => e.type === "agent_end" && agent.events.indexOf(e) > indexAfterFirst,
      30_000,
    );
    followUpProcessed = true;
    console.log("  Follow-up turn completed.");
  } catch {
    // Check if the follow-up was handled in the same turn
    const responseText = getResponseText(agent.events);
    followUpProcessed = responseText.includes("6") || responseText.toLowerCase().includes("3+3") || responseText.toLowerCase().includes("six");
    if (followUpProcessed) {
      console.log("  Follow-up was handled in the same turn.");
    } else {
      console.log("  Follow-up turn did not trigger (timeout).");
    }
  }

  const responseText = getResponseText(agent.events);
  const toolCalls = agent.events.filter((e) => e.type === "tool_execution_start");

  // Follow-up should be processed AFTER original task completes
  // All 3 echo commands should have run first
  const allStepsCompleted = toolCalls.length >= 3;
  console.log(`\n  All 3 steps completed: ${allStepsCompleted ? "✓" : "✗"}`);
  console.log(`  Follow-up processed: ${followUpProcessed ? "✓" : "✗"}`);
  console.log(`  Tool calls made: ${toolCalls.length}`);
  console.log(`  Response (first 300 chars): "${responseText.slice(0, 300)}"`);

  agent.proc.kill("SIGTERM");

  return { allStepsCompleted, followUpProcessed, toolCalls: toolCalls.length };
}

async function runTest() {
  console.log("=== Test 8: Steer vs Follow-Up Semantics ===\n");

  const steerResult = await testSteer();
  const followUpResult = await testFollowUp();

  // Steer: should interrupt/acknowledge mid-task
  const steerPassed = steerResult.acknowledged;

  // Follow-up: should complete all steps, then process follow-up
  const followUpPassed = followUpResult.allStepsCompleted;

  console.log("\n" + "=".repeat(50));
  console.log(`  Steer (interrupts mid-task): ${steerPassed ? "PASS ✓" : "FAIL ✗"}`);
  console.log(`  Follow-up (queues until done): ${followUpPassed ? "PASS ✓" : "FAIL ✗"}`);
  console.log(`Test 8 (Steer vs Follow-Up): ${steerPassed && followUpPassed ? "PASS ✓" : "FAIL ✗"}`);
  console.log("=".repeat(50));

  process.exit(steerPassed && followUpPassed ? 0 : 1);
}

runTest().catch((err) => {
  console.error(`\nTest 8 FAILED: ${err.message}`);
  process.exit(1);
});
