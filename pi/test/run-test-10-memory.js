#!/usr/bin/env node
/**
 * Test 10: Memory Profile
 *
 * Validates: Pi agents fit within target memory budget.
 * Spawns 3 agents, measures RSS at startup and after one prompt each.
 *
 * Prerequisites: ANTHROPIC_API_KEY set, pi installed globally
 *
 * Usage: node pi/test/run-test-10-memory.js
 */

import { spawn, execSync } from "child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { createRpcClient } from "../rpc-client.js";

const TIMEOUT = 90_000;
const WORKTREE = process.cwd();
const EXT_PATH = join(WORKTREE, "pi/extensions/cc-dev-team-messaging.ts");
const MAX_RSS_MB = 2048; // Target: < 2GB total for 3 agents

function measureRss(pids) {
  let totalMb = 0;
  const details = {};
  for (const [role, pid] of Object.entries(pids)) {
    try {
      const result = execSync(`ps -o rss= -p ${pid}`, { encoding: "utf-8" }).trim();
      const mb = parseInt(result, 10) / 1024;
      details[role] = Math.round(mb);
      totalMb += mb;
    } catch {
      details[role] = 0;
    }
  }
  return { totalMb: Math.round(totalMb), details };
}

function spawnAgent(role, dbPath, sessionId) {
  const agentDir = join(WORKTREE, "pi/agents", role);
  const proc = spawn("pi", [
    "--mode", "rpc",
    "--provider", "anthropic",
    "--model", "claude-haiku-4-5",
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
        console.error(`  [DEBUG] ${role} timed out. Events: ${JSON.stringify(events.map(e => ({type: e.type, ...(e.error ? {error: e.error} : {}), ...(e.event ? {event: e.event} : {})})))}`);
        console.error(`  [DEBUG] ${role} stderr: ${stderr.slice(0, 500)}`);
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
      // Check existing events first
      for (const e of events) {
        if (e.type === "agent_end") {
          clearTimeout(timer);
          resolve(e);
          return;
        }
      }
      waiters.push(check);
    });
  };

  return { proc, client, events, waitForAgentEnd, role, getStderr: () => stderr };
}

async function runTest() {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const dbPath = join(tmpDir, "messages.db");
  const sessionId = `test-${Date.now()}`;

  console.log("=== Test 10: Memory Profile ===\n");

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

  // Spawn 3 agents (staggered to avoid lock file contention)
  console.log("1. Spawning 3 agents (staggered)...");
  const pm = spawnAgent("pm", dbPath, sessionId);
  await new Promise((r) => setTimeout(r, 3000));
  const architect = spawnAgent("architect", dbPath, sessionId);
  await new Promise((r) => setTimeout(r, 3000));
  const engineer = spawnAgent("engineer", dbPath, sessionId);
  await new Promise((r) => setTimeout(r, 3000));

  const pids = {
    pm: pm.proc.pid,
    architect: architect.proc.pid,
    engineer: engineer.proc.pid,
  };

  // Measure startup RSS
  const startup = measureRss(pids);
  console.log(`\n2. Startup RSS: ${startup.totalMb}MB total`);
  console.log(`   PM: ${startup.details.pm}MB, Architect: ${startup.details.architect}MB, Engineer: ${startup.details.engineer}MB`);

  // Run a simple prompt on each agent sequentially
  console.log("\n3. Running prompts (sequential)...");

  for (const agent of [pm, architect, engineer]) {
    console.log(`   Prompting ${agent.role}...`);
    agent.client.send({
      type: "prompt",
      id: `${agent.role}-task`,
      message: `Say '${agent.role} ready' in one line. Do not use any tools.`,
    });
    await agent.waitForAgentEnd();
    console.log(`   ${agent.role} responded.`);
  }

  // Measure post-prompt RSS
  const active = measureRss(pids);
  console.log(`\n4. Post-prompt RSS: ${active.totalMb}MB total`);
  console.log(`   PM: ${active.details.pm}MB, Architect: ${active.details.architect}MB, Engineer: ${active.details.engineer}MB`);

  // Wait for idle
  await new Promise((r) => setTimeout(r, 3000));
  const idle = measureRss(pids);
  console.log(`\n5. Idle RSS: ${idle.totalMb}MB total`);
  console.log(`   PM: ${idle.details.pm}MB, Architect: ${idle.details.architect}MB, Engineer: ${idle.details.engineer}MB`);

  const peakRss = Math.max(startup.totalMb, active.totalMb, idle.totalMb);

  // Cleanup
  pm.proc.kill("SIGTERM");
  architect.proc.kill("SIGTERM");
  engineer.proc.kill("SIGTERM");
  try { rmSync(tmpDir, { recursive: true }); } catch {}

  const passed = peakRss < MAX_RSS_MB;

  console.log("\n" + "=".repeat(50));
  console.log(`  Peak RSS: ${peakRss}MB (target: <${MAX_RSS_MB}MB)`);
  console.log(`  Per-agent average: ~${Math.round(peakRss / 3)}MB`);
  console.log(`Test 10 (Memory Profile): ${passed ? "PASS ✓" : "FAIL ✗"}`);
  console.log("=".repeat(50));

  process.exit(passed ? 0 : 1);
}

runTest().catch((err) => {
  console.error(`\nTest 10 FAILED: ${err.message}`);
  process.exit(1);
});
