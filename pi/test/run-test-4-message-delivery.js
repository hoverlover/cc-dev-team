#!/usr/bin/env node
/**
 * Test 4: Message Delivery (Steer)
 *
 * Validates: Messages delivered between tool calls via steer.
 * Spawns two Pi agents sharing the same SQLite DB.
 * Agent-b sends a message while agent-a is working.
 * Verifies agent-a receives it via the extension's tool_execution_end handler.
 *
 * Prerequisites: ANTHROPIC_API_KEY set, pi installed globally
 *
 * Usage: node pi/test/run-test-4-message-delivery.js
 */

import { spawn } from "child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createRpcClient } from "../rpc-client.js";

const TIMEOUT = 120_000;
const WORKTREE = process.cwd();
const EXT_PATH = join(WORKTREE, "pi/extensions/cc-dev-team-messaging.ts");

function spawnAgent(role, dbPath, sessionId, agentDir) {
  const proc = spawn("pi", [
    "--mode", "rpc",
    "--provider", "anthropic",
    "--model", "claude-haiku-4-5",
    "--no-session",
    "--thinking", "off",
    "-e", EXT_PATH,
  ], {
    cwd: agentDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      CC_AGENT_ROLE: role,
      CC_SESSION_ID: sessionId,
      CC_DB_PATH: dbPath,
    },
  });

  const events = [];
  let stderr = "";
  const waiters = [];

  proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  const client = createRpcClient(
    proc.stdout,
    proc.stdin,
    (event) => {
      events.push(event);
      for (const w of waiters) w(event);
    },
  );

  const waitForEvent = (predicate, timeout = TIMEOUT) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for event in ${role}`)), timeout);
      const check = (event) => {
        if (predicate(event)) {
          clearTimeout(timer);
          resolve(event);
        }
      };
      for (const e of events) {
        if (predicate(e)) { clearTimeout(timer); resolve(e); return; }
      }
      waiters.push(check);
    });
  };

  return { proc, client, events, waitForEvent, getStderr: () => stderr, role };
}

async function runTest() {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const dbPath = join(tmpDir, "messages.db");
  const sessionId = `test-${Date.now()}`;

  console.log("=== Test 4: Message Delivery (Steer) ===\n");
  console.log(`  DB: ${dbPath}`);
  console.log(`  Session: ${sessionId}\n`);

  // Set up SQLite schema
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      session_id TEXT,
      from_agent TEXT,
      to_agent TEXT,
      thread_id TEXT,
      message_type TEXT,
      content TEXT,
      read INTEGER DEFAULT 0
    )
  `);
  db.close();

  // Spawn agent-a (engineer) - will be given a multi-step task
  console.log("1. Spawning engineer agent...");
  const agentA = spawnAgent(
    "engineer",
    dbPath, sessionId,
    join(WORKTREE, "pi/agents/engineer"),
  );

  console.log("2. (PM will be simulated via direct SQLite insert)");

  // Wait for Pi processes to initialize (load extensions, etc.)
  console.log("\n  Waiting for Pi processes to initialize...");
  await new Promise((r) => setTimeout(r, 3000));

  // Give agent-a a multi-step task that involves tool calls
  console.log("3. Sending multi-step task to engineer...");
  agentA.client.send({
    type: "prompt",
    id: "task-a",
    message: "Please do 3 things, one at a time: (1) Use the read tool to read the file SYSTEM.md, (2) Use bash to run 'echo step2', (3) Use bash to run 'echo step3'. Do each step one at a time.",
  });

  // Wait for engineer to start working (first tool call)
  console.log("4. Waiting for engineer to start tool calls...");
  await agentA.waitForEvent((e) => e.type === "tool_execution_start");
  console.log("  Engineer started first tool call.");

  // Instead of making PM use the send_msg tool (which takes time),
  // directly insert a message into SQLite — simulating what PM's send_msg would do.
  // This isolates the test to message DELIVERY, not message SENDING.
  console.log("\n5. Inserting message directly into SQLite (simulating PM send)...");
  await new Promise((r) => setTimeout(r, 1000));
  const insertDb = new DatabaseSync(dbPath);
  insertDb.prepare(
    "INSERT INTO messages (session_id, from_agent, to_agent, message_type, content, read) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(sessionId, "pm", "engineer", "QUESTION", "Are you almost done with the task?");
  insertDb.close();
  console.log("  Message inserted into SQLite.");
  console.log("  PM finished sending message.");

  // Wait for engineer's agent_end (engineer finishes all tasks)
  console.log("\n6. Waiting for engineer to finish...");
  const engineerEnd = await agentA.waitForEvent((e) => e.type === "agent_end");

  // Check if engineer received the message
  console.log("\n7. Analyzing engineer's events...");

  // Look for team-messages injection in engineer's events
  // The message should appear in the agent's context as a steer message
  const engineerAgentEnd = agentA.events.find((e) => e.type === "agent_end");
  const allMessages = engineerAgentEnd?.messages || [];

  // Check for any text containing the PM's question
  let messageReceived = false;
  for (const msg of allMessages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text" && block.text?.includes("almost done")) {
          messageReceived = true;
        }
      }
    }
  }

  // Also check: the extension would have injected a steer message
  // Look for custom messages in the conversation
  const hasTeamMessage = allMessages.some(
    (m) => m.customType === "team-messages" ||
           (m.role === "user" && typeof m.content === "string" && m.content.includes("TEAM MESSAGE"))
  );

  // Check SQLite for the message
  const verifyDb = new DatabaseSync(dbPath);
  const pmMsg = verifyDb.prepare(
    "SELECT * FROM messages WHERE session_id = ? AND from_agent = 'pm' AND to_agent = 'engineer'"
  ).all(sessionId);
  const readStatus = verifyDb.prepare(
    "SELECT read FROM messages WHERE session_id = ? AND from_agent = 'pm' AND to_agent = 'engineer'"
  ).all(sessionId);
  verifyDb.close();

  console.log(`  PM message in SQLite: ${pmMsg.length > 0 ? "✓" : "✗"}`);
  console.log(`  Message marked read: ${readStatus.some(r => r.read === 1) ? "✓" : "✗"}`);
  console.log(`  Engineer acknowledged message: ${messageReceived ? "✓" : "✗ (may be in steer context)"}`);

  // The key validation: message was in DB AND was marked as read
  // (meaning the extension picked it up)
  const messageWasDelivered = pmMsg.length > 0 && readStatus.some(r => r.read === 1);
  console.log(`  Message delivery confirmed: ${messageWasDelivered ? "✓" : "✗"}`);

  // Count tool calls engineer made
  const toolCalls = agentA.events.filter((e) => e.type === "tool_execution_start");
  console.log(`\n  Engineer tool calls: ${toolCalls.length}`);
  for (const tc of toolCalls) {
    console.log(`    - ${tc.toolName}: ${JSON.stringify(tc.args).slice(0, 80)}`);
  }

  // Cleanup
  agentA.proc.kill("SIGTERM");
  try { rmSync(tmpDir, { recursive: true }); } catch {}

  const passed = messageWasDelivered;

  console.log("\n" + "=".repeat(50));
  console.log(`Test 4 (Message Delivery): ${passed ? "PASS ✓" : "FAIL ✗"}`);
  const stderrText = agentA.getStderr().replace(/ExperimentalWarning.*\n?/g, "").trim();
  if (stderrText) {
    console.log(`\nEngineer stderr:\n${stderrText.slice(0, 300)}`);
  }
  console.log("=".repeat(50));

  process.exit(passed ? 0 : 1);
}

runTest().catch((err) => {
  console.error(`\nTest 4 FAILED with error: ${err.message}`);
  process.exit(1);
});
