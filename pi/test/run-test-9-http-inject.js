#!/usr/bin/env node
/**
 * Test 9: Broker HTTP Endpoint (Message Injection)
 *
 * Validates: An HTTP endpoint can write messages to SQLite,
 * which agents then pick up via the extension's message delivery.
 *
 * This test simulates what a real broker HTTP endpoint would do:
 * 1. Start an agent
 * 2. Write a message to SQLite via HTTP-style injection
 * 3. Verify the agent picks up and processes the message
 *
 * Prerequisites: ANTHROPIC_API_KEY set, pi installed globally
 *
 * Usage: node pi/test/run-test-9-http-inject.js
 */

import { spawn } from "child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createServer } from "http";
import { createRpcClient } from "../rpc-client.js";

const TIMEOUT = 60_000;
const WORKTREE = process.cwd();
const EXT_PATH = join(WORKTREE, "pi/extensions/cc-dev-team-messaging.ts");

async function runTest() {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const dbPath = join(tmpDir, "messages.db");
  const sessionId = `test-${Date.now()}`;

  console.log("=== Test 9: Broker HTTP Endpoint (Message Injection) ===\n");
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

  // Start a minimal HTTP server that injects messages into SQLite
  let httpPort;
  const httpServer = createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/inject-message") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const msg = JSON.parse(body);
          const injDb = new DatabaseSync(dbPath);
          injDb.prepare(
            `INSERT INTO messages (session_id, from_agent, to_agent, message_type, content, read)
             VALUES (?, ?, ?, ?, ?, 0)`
          ).run(sessionId, msg.from || "human", msg.to, msg.type, msg.content);
          injDb.close();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  await new Promise((resolve) => {
    httpServer.listen(0, () => {
      httpPort = httpServer.address().port;
      console.log(`1. HTTP server listening on port ${httpPort}`);
      resolve();
    });
  });

  // Spawn PM agent
  console.log("2. Spawning PM agent...");
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

  proc.stderr.on("data", () => {});

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

  await new Promise((r) => setTimeout(r, 3000));

  // Step 1: Give PM a task so it's active
  console.log("\n3. Sending initial task to PM (multi-step to keep it busy)...");
  client.send({
    type: "prompt",
    id: "initial-task",
    message: "Use bash to run 'echo task-start', then use bash to run 'echo task-middle', then use bash to run 'echo task-end'. Do each step one at a time.",
  });

  // Wait for first tool to start
  await waitForEvent((e) => e.type === "tool_execution_start");

  // Step 2: Inject a message via HTTP while PM is working
  console.log("4. Injecting message via HTTP endpoint...");
  const injectResponse = await fetch(`http://localhost:${httpPort}/api/inject-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "human",
      to: "pm",
      type: "HUMAN_RESPONSE",
      content: "Use the REST API approach for the backend.",
    }),
  });

  const injectResult = await injectResponse.json();
  console.log(`  HTTP inject result: ${JSON.stringify(injectResult)}`);

  // Verify message is in SQLite
  const checkDb = new DatabaseSync(dbPath);
  const injectedMsg = checkDb.prepare(
    "SELECT * FROM messages WHERE session_id = ? AND from_agent = 'human' AND to_agent = 'pm'"
  ).all(sessionId);
  checkDb.close();
  console.log(`  Message in SQLite: ${injectedMsg.length > 0 ? "✓" : "✗"}`);

  // Wait for PM to finish
  console.log("\n5. Waiting for PM to finish...");
  await waitForEvent((e) => e.type === "agent_end");

  // Verify the message was delivered (marked as read by extension)
  const verifyDb = new DatabaseSync(dbPath);
  const readStatus = verifyDb.prepare(
    "SELECT read FROM messages WHERE session_id = ? AND from_agent = 'human' AND to_agent = 'pm'"
  ).all(sessionId);
  verifyDb.close();

  const messageDelivered = readStatus.length > 0 && readStatus.some((r) => r.read === 1);
  console.log(`  Message marked read (delivered): ${messageDelivered ? "✓" : "✗"}`);

  // Check if PM acknowledged the message in its response
  const agentEnd = events.find((e) => e.type === "agent_end");
  const allMessages = agentEnd?.messages || [];
  let responseText = "";
  for (const msg of allMessages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "text") responseText += block.text;
      }
    }
  }

  const acknowledged = responseText.toLowerCase().includes("rest") ||
    responseText.toLowerCase().includes("api") ||
    responseText.toLowerCase().includes("backend");
  console.log(`  PM acknowledged injected message: ${acknowledged ? "✓" : "✗ (may have been delivered but not acted on)"}`);

  // Cleanup
  proc.kill("SIGTERM");
  httpServer.close();
  try { rmSync(tmpDir, { recursive: true }); } catch {}

  // Pass criteria: message was injected via HTTP AND delivered to agent
  const passed = injectResult.ok && injectedMsg.length > 0 && messageDelivered;

  console.log("\n" + "=".repeat(50));
  console.log(`  HTTP inject worked: ${injectResult.ok ? "✓" : "✗"}`);
  console.log(`  Message persisted to SQLite: ${injectedMsg.length > 0 ? "✓" : "✗"}`);
  console.log(`  Message delivered to agent: ${messageDelivered ? "✓" : "✗"}`);
  console.log(`Test 9 (HTTP Message Injection): ${passed ? "PASS ✓" : "FAIL ✗"}`);
  console.log("=".repeat(50));

  process.exit(passed ? 0 : 1);
}

runTest().catch((err) => {
  console.error(`\nTest 9 FAILED: ${err.message}`);
  process.exit(1);
});
