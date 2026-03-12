#!/usr/bin/env node
/**
 * Test 7: Multi-Provider
 *
 * Validates: Different agents can use different LLM providers.
 * Spawns PM on Anthropic (Haiku) and Architect on Groq (llama3-8b).
 * Both share the same SQLite DB for messaging.
 * Verifies both agents respond correctly and messages flow between them.
 *
 * Prerequisites: ANTHROPIC_API_KEY and GROQ_API_KEY set, pi installed globally
 *
 * Usage: node pi/test/run-test-7-multi-provider.js
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

function spawnAgent(role, provider, model, dbPath, sessionId) {
  const agentDir = join(WORKTREE, "pi/agents", role);
  const proc = spawn("pi", [
    "--mode", "rpc",
    "--provider", provider,
    "--model", model,
    "--no-session",
    "--thinking", "off",
    "--append-system-prompt", join(agentDir, "SYSTEM.md"),
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
  const waiters = [];
  let stderr = "";

  proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  const client = createRpcClient(proc.stdout, proc.stdin, (event) => {
    events.push(event);
    for (const w of [...waiters]) w(event);
  });

  const waitForAgentEnd = (timeout = TIMEOUT) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        console.error(`  [DEBUG] ${role} (${provider}) timed out. Events: ${events.map(e => e.type).join(", ")}`);
        reject(new Error(`Timeout: ${role} agent_end`));
      }, timeout);
      const check = (event) => {
        if (event.type === "agent_end") {
          clearTimeout(timer);
          const idx = waiters.indexOf(check);
          if (idx >= 0) waiters.splice(idx, 1);
          resolve(event);
        }
      };
      for (const e of events) {
        if (e.type === "agent_end") { clearTimeout(timer); resolve(e); return; }
      }
      waiters.push(check);
    });
  };

  return { proc, client, events, waitForAgentEnd, role, provider, model, getStderr: () => stderr };
}

async function runTest() {
  // Check prerequisites
  if (!process.env.GROQ_API_KEY) {
    console.log("=== Test 7: Multi-Provider ===\n");
    console.log("SKIPPED: GROQ_API_KEY not set. Need at least 2 providers for this test.");
    console.log("Set GROQ_API_KEY and try again.");
    process.exit(0);
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const dbPath = join(tmpDir, "messages.db");
  const sessionId = `test-${Date.now()}`;

  console.log("=== Test 7: Multi-Provider ===\n");
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

  // Spawn agents on different providers (staggered for lock file)
  console.log("1. Spawning agents on different providers...");
  console.log("   PM: anthropic/claude-haiku-4-5");
  const pm = spawnAgent("pm", "anthropic", "claude-haiku-4-5", dbPath, sessionId);
  await new Promise((r) => setTimeout(r, 3000));

  console.log("   Architect: groq/llama-3.3-70b-versatile");
  const architect = spawnAgent("architect", "groq", "llama-3.3-70b-versatile", dbPath, sessionId);
  await new Promise((r) => setTimeout(r, 3000));

  // Test 1: PM sends message to architect
  console.log("\n2. PM sends TASK_ASSIGNMENT to architect...");
  pm.client.send({
    type: "prompt",
    id: "pm-task",
    message: "Use the send_msg tool to send a TASK_ASSIGNMENT to architect with content: 'Design a simple add(a, b) function that returns the sum of two numbers. Keep it brief.' Do this now, then stop.",
  });
  await pm.waitForAgentEnd();

  // Check message was sent
  let msgs = new DatabaseSync(dbPath).prepare(
    "SELECT * FROM messages WHERE session_id = ? ORDER BY id"
  ).all(sessionId);
  new DatabaseSync(dbPath); // just to close - actually need explicit close
  const checkDb1 = new DatabaseSync(dbPath);
  msgs = checkDb1.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY id").all(sessionId);
  checkDb1.close();

  const pmToArch = msgs.find((m) => m.from_agent === "pm" && m.to_agent === "architect");
  console.log(`   PM → Architect (via Anthropic): ${pmToArch ? "✓" : "✗"}`);

  // Test 2: Architect receives and responds
  if (pmToArch) {
    console.log("\n3. Architect receives and responds (via Groq)...");
    architect.client.send({
      type: "prompt",
      id: "arch-task",
      message: `NEW TEAM MESSAGE(S): [MESSAGE from pm] [${pmToArch.message_type}]: ${pmToArch.content}\n\nDesign the function and use send_msg to send a RESPONSE to pm with your design. Keep it brief.`,
    });

    const markDb = new DatabaseSync(dbPath);
    markDb.prepare("UPDATE messages SET read = 1 WHERE id = ?").run(pmToArch.id);
    markDb.close();

    await architect.waitForAgentEnd();
  }

  const checkDb2 = new DatabaseSync(dbPath);
  msgs = checkDb2.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY id").all(sessionId);
  checkDb2.close();

  const archToPm = msgs.find((m) => m.from_agent === "architect" && m.to_agent === "pm");
  console.log(`   Architect → PM (via Groq): ${archToPm ? "✓" : "✗"}`);

  // Verify each provider was actually used
  const pmEvents = pm.events;
  const archEvents = architect.events;

  // Check for tool calls in both agents
  const pmToolCalls = pmEvents.filter((e) => e.type === "tool_execution_start" && e.toolName === "send_msg");
  const archToolCalls = archEvents.filter((e) => e.type === "tool_execution_start" && e.toolName === "send_msg");

  console.log(`\n4. Provider verification:`);
  console.log(`   PM (Anthropic) made ${pmToolCalls.length} send_msg calls`);
  console.log(`   Architect (Groq) made ${archToolCalls.length} send_msg calls`);

  // Full message flow
  console.log("\n5. Message flow:");
  for (const m of msgs) {
    console.log(`   ${m.from_agent} → ${m.to_agent} [${m.message_type}]: ${(m.content || "").slice(0, 60)}...`);
  }

  // Cleanup
  pm.proc.kill("SIGTERM");
  architect.proc.kill("SIGTERM");
  try { rmSync(tmpDir, { recursive: true }); } catch {}

  // Pass if both providers could send/receive messages
  const passed = !!pmToArch && !!archToPm;

  console.log("\n" + "=".repeat(50));
  console.log(`  PM (Anthropic) → Architect: ${pmToArch ? "✓" : "✗"}`);
  console.log(`  Architect (Groq) → PM: ${archToPm ? "✓" : "✗"}`);
  console.log(`Test 7 (Multi-Provider): ${passed ? "PASS ✓" : "FAIL ✗"}`);
  console.log("=".repeat(50));

  process.exit(passed ? 0 : 1);
}

runTest().catch((err) => {
  console.error(`\nTest 7 FAILED: ${err.message}`);
  process.exit(1);
});
