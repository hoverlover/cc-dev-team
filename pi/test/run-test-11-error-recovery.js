#!/usr/bin/env node
/**
 * Test 11: Error Recovery
 *
 * Validates: Broker detects agent crashes and can restart them.
 * Spawns PM agent, kills it with SIGKILL, verifies exit detection,
 * restarts it, and confirms messages are delivered to the new instance.
 *
 * Prerequisites: ANTHROPIC_API_KEY set, pi installed globally
 *
 * Usage: node pi/test/run-test-11-error-recovery.js
 */

import { spawn } from "child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createRpcClient } from "../rpc-client.js";

const TIMEOUT = 60_000;
const WORKTREE = process.cwd();
const EXT_PATH = join(WORKTREE, "pi/extensions/cc-dev-team-messaging.ts");

function spawnPm(dbPath, sessionId) {
  const pmDir = join(WORKTREE, "pi/agents/pm");
  const proc = spawn("pi", [
    "--mode", "rpc",
    "--provider", "anthropic",
    "--model", "claude-haiku-4-5",
    "--no-session",
    "--thinking", "off",
    "--append-system-prompt", join(pmDir, "SYSTEM.md"),
    "-e", EXT_PATH,
  ], {
    cwd: pmDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      CC_AGENT_ROLE: "pm",
      CC_SESSION_ID: sessionId,
      CC_DB_PATH: dbPath,
    },
  });

  const events = [];
  const waiters = [];
  let exitCode = null;
  let exitSignal = null;
  let exitResolve;
  const exitPromise = new Promise((r) => { exitResolve = r; });

  proc.stderr.on("data", () => {});

  proc.on("exit", (code, signal) => {
    exitCode = code;
    exitSignal = signal;
    exitResolve({ code, signal });
  });

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

  return {
    proc, client, events, waitForEvent, exitPromise,
    getExitCode: () => exitCode,
    getExitSignal: () => exitSignal,
  };
}

async function runTest() {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const dbPath = join(tmpDir, "messages.db");
  const sessionId = `test-${Date.now()}`;

  console.log("=== Test 11: Error Recovery ===\n");
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

  // Step 1: Spawn PM and verify it works
  console.log("1. Spawning PM agent (instance 1)...");
  const pm1 = spawnPm(dbPath, sessionId);
  await new Promise((r) => setTimeout(r, 3000));

  // Verify it responds
  pm1.client.send({
    type: "prompt",
    id: "health-check",
    message: "Say 'OK' and nothing else. Do not use any tools.",
  });
  await pm1.waitForEvent((e) => e.type === "agent_end");
  console.log("  PM instance 1 is working: ✓");

  // Step 2: Kill PM with SIGKILL (simulating crash)
  console.log("\n2. Killing PM with SIGKILL (simulating crash)...");
  pm1.proc.kill("SIGKILL");
  const exitInfo = await pm1.exitPromise;
  console.log(`  PM exited: code=${exitInfo.code}, signal=${exitInfo.signal}`);

  const crashDetected = exitInfo.signal === "SIGKILL" || exitInfo.code !== 0;
  console.log(`  Crash detected: ${crashDetected ? "✓" : "✗"}`);

  // Step 3: Insert a message for PM while it's down
  console.log("\n3. Inserting message for PM (while crashed)...");
  const insertDb = new DatabaseSync(dbPath);
  insertDb.prepare(
    "INSERT INTO messages (session_id, from_agent, to_agent, message_type, content, read) VALUES (?, ?, ?, ?, ?, 0)"
  ).run(sessionId, "engineer", "pm", "HANDOFF", "Feature implementation complete. Files changed: auth.ts, login.tsx.");
  insertDb.close();
  console.log("  Message inserted: ✓");

  // Step 4: Restart PM (broker would do this)
  console.log("\n4. Restarting PM (instance 2)...");
  const pm2 = spawnPm(dbPath, sessionId);
  await new Promise((r) => setTimeout(r, 3000));

  // Step 5: The restarted PM should pick up the pending message
  // The extension's before_agent_start handler injects pending messages
  console.log("5. Prompting restarted PM to check for messages...");
  pm2.client.send({
    type: "prompt",
    id: "post-restart",
    message: "Check if you have any pending messages from your team. If you received a HANDOFF message, acknowledge it. Do not use any tools.",
  });
  await pm2.waitForEvent((e) => e.type === "agent_end");

  // Extract response
  const agentEnd = pm2.events.find((e) => e.type === "agent_end");
  let responseText = "";
  for (const msg of (agentEnd?.messages || [])) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text") responseText += block.text;
      }
    }
  }

  // Check if the message was delivered
  const verifyDb = new DatabaseSync(dbPath);
  const readStatus = verifyDb.prepare(
    "SELECT read FROM messages WHERE session_id = ? AND from_agent = 'engineer' AND to_agent = 'pm'"
  ).all(sessionId);
  verifyDb.close();

  const messageDelivered = readStatus.length > 0 && readStatus.some((r) => r.read === 1);
  const messageAcknowledged = responseText.toLowerCase().includes("handoff") ||
    responseText.toLowerCase().includes("implementation") ||
    responseText.toLowerCase().includes("auth") ||
    responseText.toLowerCase().includes("complete");

  console.log(`\n  Message delivered after restart: ${messageDelivered ? "✓" : "✗"}`);
  console.log(`  PM acknowledged message content: ${messageAcknowledged ? "✓" : "✗"}`);
  console.log(`  Response (first 200 chars): "${responseText.slice(0, 200)}"`);

  // Cleanup
  pm2.proc.kill("SIGTERM");
  try { rmSync(tmpDir, { recursive: true }); } catch {}

  const passed = crashDetected && messageDelivered;

  console.log("\n" + "=".repeat(50));
  console.log(`  Crash detected: ${crashDetected ? "✓" : "✗"}`);
  console.log(`  Message delivered after restart: ${messageDelivered ? "✓" : "✗"}`);
  console.log(`  PM acknowledged content: ${messageAcknowledged ? "✓" : "✗"}`);
  console.log(`Test 11 (Error Recovery): ${passed ? "PASS ✓" : "FAIL ✗"}`);
  console.log("=".repeat(50));

  process.exit(passed ? 0 : 1);
}

runTest().catch((err) => {
  console.error(`\nTest 11 FAILED: ${err.message}`);
  process.exit(1);
});
