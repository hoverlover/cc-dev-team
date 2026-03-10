#!/usr/bin/env node
/**
 * Test 6: Multi-Agent Orchestration
 *
 * Validates: Full PM → Architect → Engineer message flow works.
 * Uses broker-side wake-up: broker polls SQLite and delivers
 * messages to idle agents via RPC prompts.
 *
 * Prerequisites: ANTHROPIC_API_KEY set, pi installed globally
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

function spawnAgent(role, dbPath, sessionId) {
  const proc = spawn("pi", [
    "--mode", "rpc",
    "--provider", "anthropic",
    "--model", "claude-haiku-4-5",
    "--no-session",
    "--thinking", "off",
    "-e", EXT_PATH,
  ], {
    cwd: join(WORKTREE, "pi/agents", role),
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

  proc.stderr.on("data", () => {}); // suppress

  const client = createRpcClient(proc.stdout, proc.stdin, (event) => {
    events.push(event);
    for (const w of [...waiters]) w(event);
  });

  const waitForAgentEnd = (timeout = TIMEOUT) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timeout: ${role} agent_end`)),
        timeout,
      );
      const check = (event) => {
        if (event.type === "agent_end") {
          clearTimeout(timer);
          const idx = waiters.indexOf(check);
          if (idx >= 0) waiters.splice(idx, 1);
          resolve(event);
        }
      };
      // Don't check existing events - we always want the NEXT agent_end
      waiters.push(check);
    });
  };

  return { proc, client, events, waitForAgentEnd, role };
}

function getMessages(dbPath, sessionId) {
  const db = new DatabaseSync(dbPath);
  const rows = db.prepare(
    "SELECT * FROM messages WHERE session_id = ? ORDER BY id"
  ).all(sessionId);
  db.close();
  return rows;
}

async function runTest() {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const dbPath = join(tmpDir, "messages.db");
  const sessionId = `test-${Date.now()}`;

  console.log("=== Test 6: Multi-Agent Orchestration ===\n");

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

  // Spawn all 3 agents
  console.log("1. Spawning agents...");
  const pm = spawnAgent("pm", dbPath, sessionId);
  const architect = spawnAgent("architect", dbPath, sessionId);
  const engineer = spawnAgent("engineer", dbPath, sessionId);
  await new Promise((r) => setTimeout(r, 3000));

  // Step 1: PM receives task and delegates to architect
  console.log("\n2. PM: Delegating to architect...");
  pm.client.send({
    type: "prompt",
    id: "step1",
    message: "Use the send_msg tool to send a TASK_ASSIGNMENT to architect with content: 'Design a TypeScript isPrime function that handles edge cases (negative numbers, 0, 1)'. Do this now, then stop.",
  });
  await pm.waitForAgentEnd();

  let msgs = getMessages(dbPath, sessionId);
  const pmToArch = msgs.find((m) => m.from_agent === "pm" && m.to_agent === "architect");
  console.log(`  PM → Architect: ${pmToArch ? "✓" : "✗"}`);

  // Step 2: Broker delivers to architect
  console.log("\n3. Architect: Receiving and responding...");
  if (pmToArch) {
    architect.client.send({
      type: "prompt",
      id: "step2",
      message: `NEW TEAM MESSAGE(S): [MESSAGE from pm] [${pmToArch.message_type}]: ${pmToArch.content}\n\nDesign the function and use send_msg to send a RESPONSE to pm with your design.`,
    });
    // Mark as read
    const mdb = new DatabaseSync(dbPath);
    mdb.prepare("UPDATE messages SET read = 1 WHERE id = ?").run(pmToArch.id);
    mdb.close();

    await architect.waitForAgentEnd();
  }

  msgs = getMessages(dbPath, sessionId);
  const archToPm = msgs.find((m) => m.from_agent === "architect" && m.to_agent === "pm");
  console.log(`  Architect → PM: ${archToPm ? "✓" : "✗"}`);

  // Step 3: Broker delivers to PM, PM delegates to engineer
  console.log("\n4. PM: Receiving design, delegating to engineer...");
  if (archToPm) {
    pm.client.send({
      type: "prompt",
      id: "step3",
      message: `NEW TEAM MESSAGE(S): [MESSAGE from architect] [${archToPm.message_type}]: ${archToPm.content}\n\nNow use send_msg to send a TASK_ASSIGNMENT to engineer with the architect's design. Include the key details.`,
    });
    const mdb = new DatabaseSync(dbPath);
    mdb.prepare("UPDATE messages SET read = 1 WHERE id = ?").run(archToPm.id);
    mdb.close();

    await pm.waitForAgentEnd();
  }

  msgs = getMessages(dbPath, sessionId);
  const pmToEng = msgs.find((m) => m.from_agent === "pm" && m.to_agent === "engineer");
  console.log(`  PM → Engineer: ${pmToEng ? "✓" : "✗"}`);

  // Step 4: Broker delivers to engineer, engineer implements
  console.log("\n5. Engineer: Implementing...");
  if (pmToEng) {
    engineer.client.send({
      type: "prompt",
      id: "step4",
      message: `NEW TEAM MESSAGE(S): [MESSAGE from pm] [${pmToEng.message_type}]: ${pmToEng.content}\n\nImplement the function. When done, use send_msg to send a HANDOFF to pm.`,
    });
    const mdb = new DatabaseSync(dbPath);
    mdb.prepare("UPDATE messages SET read = 1 WHERE id = ?").run(pmToEng.id);
    mdb.close();

    await engineer.waitForAgentEnd();
  }

  msgs = getMessages(dbPath, sessionId);
  const engToPm = msgs.find((m) => m.from_agent === "engineer" && m.to_agent === "pm");
  console.log(`  Engineer → PM: ${engToPm ? "✓" : "✗"}`);

  // Final analysis
  console.log("\n6. Full message flow:");
  msgs = getMessages(dbPath, sessionId);
  for (const m of msgs) {
    console.log(`  ${m.from_agent} → ${m.to_agent} [${m.message_type}]: ${m.content.slice(0, 80)}...`);
  }

  const flows = {
    pmToArchitect: !!pmToArch,
    architectToPm: !!archToPm,
    pmToEngineer: !!pmToEng,
    engineerToPm: !!engToPm,
  };

  // Cleanup
  pm.proc.kill("SIGTERM");
  architect.proc.kill("SIGTERM");
  engineer.proc.kill("SIGTERM");
  try { rmSync(tmpDir, { recursive: true }); } catch {}

  // Pass if full pipeline works
  const passed = flows.pmToArchitect && flows.architectToPm && flows.pmToEngineer && flows.engineerToPm;

  console.log(`\n  PM → Architect:  ${flows.pmToArchitect ? "✓" : "✗"}`);
  console.log(`  Architect → PM:  ${flows.architectToPm ? "✓" : "✗"}`);
  console.log(`  PM → Engineer:   ${flows.pmToEngineer ? "✓" : "✗"}`);
  console.log(`  Engineer → PM:   ${flows.engineerToPm ? "✓" : "✗"}`);

  console.log("\n" + "=".repeat(50));
  console.log(`Test 6 (Multi-Agent Orchestration): ${passed ? "PASS ✓" : "FAIL ✗"}`);
  console.log("=".repeat(50));

  process.exit(passed ? 0 : 1);
}

runTest().catch((err) => {
  console.error(`\nTest 6 FAILED: ${err.message}`);
  process.exit(1);
});
