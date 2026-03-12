#!/usr/bin/env node
/**
 * Test 1: Pi RPC Basic Communication
 *
 * Validates: Pi spawns in RPC mode, broker can send/receive JSONL
 *
 * Prerequisites: ANTHROPIC_API_KEY set, pi installed globally
 *
 * Usage: node pi/test/run-test-1-basic-rpc.js
 */

import { spawn } from "child_process";
import { createRpcClient } from "../rpc-client.js";

const TIMEOUT = 60_000;

async function runTest() {
  console.log("=== Test 1: Pi RPC Basic Communication ===\n");

  // Step 1: Spawn Pi in RPC mode
  console.log("1. Spawning Pi in RPC mode...");
  const proc = spawn("pi", [
    "--mode", "rpc",
    "--provider", "anthropic",
    "--model", "claude-haiku-4-5",
    "--no-session",
    "--thinking", "off",
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  const events = [];
  let agentEndResolve;
  const agentEndPromise = new Promise((r) => { agentEndResolve = r; });
  let responseResolve;
  const responsePromise = new Promise((r) => { responseResolve = r; });

  const client = createRpcClient(
    proc.stdout,
    proc.stdin,
    (event) => {
      events.push(event);
      const typeStr = event.type === "message_update"
        ? `message_update (${event.assistantMessageEvent?.type})`
        : event.type;
      console.log(`  event: ${typeStr}`);

      if (event.type === "agent_end") {
        agentEndResolve(event);
      }
      if (event.type === "response" && event.command === "prompt") {
        responseResolve(event);
      }
    },
    (err, line) => {
      console.error(`  JSONL parse error: ${err.message} for line: ${line}`);
    },
  );

  // Capture stderr
  let stderr = "";
  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  // Step 2: Send a simple prompt
  console.log("\n2. Sending prompt: 'Say hello in exactly 3 words.'");
  client.send({
    type: "prompt",
    id: "test-1",
    message: "Say hello in exactly 3 words. Do not use any tools.",
  });

  // Wait for prompt response
  const promptResponse = await Promise.race([
    responsePromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for prompt response")), TIMEOUT)),
  ]);
  console.log(`\n  prompt response: success=${promptResponse.success}`);

  // Step 3: Wait for agent_end
  console.log("\n3. Waiting for agent_end...");
  const agentEnd = await Promise.race([
    agentEndPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout waiting for agent_end")), TIMEOUT)),
  ]);

  // Step 4: Verify event sequence
  console.log("\n4. Verifying event sequence...");
  const eventTypes = events.map((e) => e.type);

  const hasResponse = eventTypes.includes("response");
  const hasAgentStart = eventTypes.includes("agent_start");
  const hasMessageStart = eventTypes.includes("message_start");
  const hasMessageUpdate = eventTypes.includes("message_update");
  const hasMessageEnd = eventTypes.includes("message_end");
  const hasAgentEnd = eventTypes.includes("agent_end");

  console.log(`  response: ${hasResponse ? "✓" : "✗"}`);
  console.log(`  agent_start: ${hasAgentStart ? "✓" : "✗"}`);
  console.log(`  message_start: ${hasMessageStart ? "✓" : "✗"}`);
  console.log(`  message_update: ${hasMessageUpdate ? "✓" : "✗"}`);
  console.log(`  message_end: ${hasMessageEnd ? "✓" : "✗"}`);
  console.log(`  agent_end: ${hasAgentEnd ? "✓" : "✗"}`);

  // Extract response text from either streaming deltas or message_end
  const textDeltas = events
    .filter((e) => e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta")
    .map((e) => e.assistantMessageEvent.delta);
  let fullText = textDeltas.join("");

  // Fallback: get text from agent_end messages (non-streaming case)
  if (!fullText && agentEnd.messages) {
    for (const msg of agentEnd.messages) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") fullText += block.text;
        }
      }
    }
  }
  console.log(`\n  Response text: "${fullText}"`);

  // Step 5: Get session stats
  console.log("\n5. Getting session stats...");
  client.send({ type: "get_session_stats", id: "stats-1" });

  // Wait for stats response to arrive in events array
  await new Promise((r) => setTimeout(r, 2000));
  const statsEvent = events.find(
    (e) => e.type === "response" && e.command === "get_session_stats"
  );

  if (statsEvent) {
    console.log(`  Token stats: input=${statsEvent.data?.tokens?.input}, output=${statsEvent.data?.tokens?.output}`);
    console.log(`  Cost: $${statsEvent.data?.cost?.toFixed(4)}`);
  } else {
    console.log("  (stats not received within timeout - non-critical)");
  }

  // Cleanup
  proc.kill("SIGTERM");

  // Verdict
  // message_update is optional for very short responses (no streaming needed)
  const passed = hasResponse && hasAgentStart && hasMessageStart && hasAgentEnd && fullText.length > 0;

  console.log("\n" + "=".repeat(50));
  console.log(`Test 1: ${passed ? "PASS ✓" : "FAIL ✗"}`);
  if (stderr.trim()) {
    console.log(`\nStderr:\n${stderr.slice(0, 500)}`);
  }
  console.log("=".repeat(50));

  process.exit(passed ? 0 : 1);
}

runTest().catch((err) => {
  console.error(`\nTest 1 FAILED with error: ${err.message}`);
  process.exit(1);
});
