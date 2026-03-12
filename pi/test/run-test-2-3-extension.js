#!/usr/bin/env node
/**
 * Tests 2 & 3: Extension Loading + Custom send_msg Tool
 *
 * Test 2: Validates the cc-dev-team-messaging extension loads
 * Test 3: Validates the LLM can call the send_msg tool
 *
 * Prerequisites: ANTHROPIC_API_KEY set, pi installed globally
 *
 * Usage: node pi/test/run-test-2-3-extension.js
 */

import { spawn } from "child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createRpcClient } from "../rpc-client.js";

const TIMEOUT = 90_000;
const WORKTREE = process.cwd();
const EXT_PATH = join(WORKTREE, "pi/extensions/cc-dev-team-messaging.ts");

async function runTest() {
  // Create temp dir for test DB
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const dbPath = join(tmpDir, "messages.db");
  const sessionId = `test-${Date.now()}`;

  console.log("=== Tests 2 & 3: Extension Loading + send_msg Tool ===\n");
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

  // ── Test 2: Extension Loading ──
  console.log("── Test 2: Extension Loading ──\n");
  console.log("1. Spawning Pi with cc-dev-team-messaging extension...");

  const proc = spawn("pi", [
    "--mode", "rpc",
    "--provider", "anthropic",
    "--model", "claude-haiku-4-5",
    "--no-session",
    "--thinking", "off",
    "-e", EXT_PATH,
  ], {
    cwd: join(WORKTREE, "pi/agents/pm"),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      CC_AGENT_ROLE: "pm",
      CC_SESSION_ID: sessionId,
      CC_DB_PATH: dbPath,
    },
  });

  const events = [];
  let stderr = "";

  proc.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  const waitForEvent = (predicate, timeout = TIMEOUT) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout")), timeout);
      const check = (event) => {
        if (predicate(event)) {
          clearTimeout(timer);
          resolve(event);
        }
      };
      // Check existing events
      for (const e of events) {
        if (predicate(e)) {
          clearTimeout(timer);
          resolve(e);
          return;
        }
      }
      // Watch for new events
      proc._waiters = proc._waiters || [];
      proc._waiters.push(check);
    });
  };

  const client = createRpcClient(
    proc.stdout,
    proc.stdin,
    (event) => {
      events.push(event);
      if (proc._waiters) {
        for (const w of proc._waiters) w(event);
      }
    },
    (err, line) => {
      console.error(`  JSONL error: ${err.message}`);
    },
  );

  // Send a simple prompt to verify extension loaded
  console.log("2. Sending test prompt...");
  client.send({
    type: "prompt",
    id: "test-ext",
    message: "What tools do you have available? List just their names, one per line. Do not call any tools.",
  });

  // Wait for agent_end
  await waitForEvent((e) => e.type === "agent_end");

  // Check for extension errors
  const extErrors = events.filter((e) => e.type === "extension_error");
  const hasExtErrors = extErrors.length > 0;

  console.log(`\n  Extension errors: ${hasExtErrors ? "✗ " + extErrors.length + " errors" : "✓ none"}`);
  if (hasExtErrors) {
    for (const err of extErrors) {
      console.log(`    ${err.event}: ${err.error}`);
    }
  }

  // Check if send_msg tool appears in response
  const agentEndEvent = events.find((e) => e.type === "agent_end");
  const assistantMsgs = agentEndEvent?.messages?.filter((m) => m.role === "assistant") || [];
  const responseText = assistantMsgs
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const hasSendMsg = responseText.toLowerCase().includes("send_msg");
  console.log(`  send_msg in tool list: ${hasSendMsg ? "✓" : "✗"}`);
  console.log(`  Response: "${responseText.slice(0, 200)}..."`);

  const test2Passed = !hasExtErrors && hasSendMsg;
  console.log(`\n  Test 2: ${test2Passed ? "PASS ✓" : "FAIL ✗"}`);

  // ── Test 3: send_msg Tool ──
  console.log("\n── Test 3: Custom send_msg Tool ──\n");
  console.log("1. Sending prompt to use send_msg tool...");

  // Clear events for this test
  events.length = 0;

  client.send({
    type: "prompt",
    id: "test-sendmsg",
    message: "Use the send_msg tool to send a STATUS_UPDATE to architect with content 'Hello from PM test'. Do this now.",
  });

  // Wait for agent_end
  await waitForEvent((e) => e.type === "agent_end");

  // Check if tool was called
  const toolCalls = events.filter((e) => e.type === "tool_execution_start" && e.toolName === "send_msg");
  const toolResults = events.filter((e) => e.type === "tool_execution_end" && e.toolName === "send_msg");

  console.log(`  send_msg tool called: ${toolCalls.length > 0 ? "✓" : "✗"} (${toolCalls.length} calls)`);
  console.log(`  send_msg tool completed: ${toolResults.length > 0 ? "✓" : "✗"}`);

  if (toolResults.length > 0) {
    const result = toolResults[0];
    const resultText = result.result?.content?.[0]?.text || "";
    console.log(`  Tool result: "${resultText}"`);
    console.log(`  Tool error: ${result.isError ? "✗ yes" : "✓ no"}`);
  }

  // Verify message in SQLite
  console.log("\n2. Checking SQLite for persisted message...");
  const verifyDb = new DatabaseSync(dbPath);
  const rows = verifyDb.prepare(
    "SELECT * FROM messages WHERE session_id = ? AND from_agent = 'pm'"
  ).all(sessionId);
  verifyDb.close();

  console.log(`  Messages in DB: ${rows.length}`);
  if (rows.length > 0) {
    const msg = rows[0];
    console.log(`  from: ${msg.from_agent}, to: ${msg.to_agent}, type: ${msg.message_type}`);
    console.log(`  content: "${msg.content}"`);
  }

  const test3Passed = toolCalls.length > 0 && rows.length > 0 && rows.some(
    (r) => r.to_agent === "architect" && r.message_type === "STATUS_UPDATE"
  );
  console.log(`\n  Test 3: ${test3Passed ? "PASS ✓" : "FAIL ✗"}`);

  // Cleanup
  proc.kill("SIGTERM");
  try { rmSync(tmpDir, { recursive: true }); } catch {}

  // Final verdict
  console.log("\n" + "=".repeat(50));
  console.log(`Test 2 (Extension Loading): ${test2Passed ? "PASS ✓" : "FAIL ✗"}`);
  console.log(`Test 3 (send_msg Tool):     ${test3Passed ? "PASS ✓" : "FAIL ✗"}`);
  if (stderr.trim()) {
    console.log(`\nStderr:\n${stderr.slice(0, 500)}`);
  }
  console.log("=".repeat(50));

  process.exit(test2Passed && test3Passed ? 0 : 1);
}

runTest().catch((err) => {
  console.error(`\nTests FAILED with error: ${err.message}`);
  process.exit(1);
});
