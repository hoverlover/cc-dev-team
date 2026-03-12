#!/usr/bin/env node
/**
 * Test 12: SYSTEM.md Loading
 *
 * Validates: Pi loads agent-specific system prompts via --append-system-prompt.
 * Spawns PM agent with its SYSTEM.md appended to the system prompt.
 * Prompts agent about its role and verifies the response reflects SYSTEM.md content.
 *
 * Prerequisites: ANTHROPIC_API_KEY set, pi installed globally
 *
 * Usage: node pi/test/run-test-12-system-md.js
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

async function runTest() {
  const tmpDir = mkdtempSync(join(tmpdir(), "pi-test-"));
  const dbPath = join(tmpDir, "messages.db");
  const sessionId = `test-${Date.now()}`;

  console.log("=== Test 12: SYSTEM.md Loading ===\n");
  console.log(`  DB: ${dbPath}`);
  console.log(`  Session: ${sessionId}\n`);

  // Set up SQLite schema (needed by extension)
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

  // Spawn PM agent with --append-system-prompt pointing to SYSTEM.md
  const pmDir = join(WORKTREE, "pi/agents/pm");
  const systemMdPath = join(pmDir, "SYSTEM.md");
  console.log(`1. Spawning PM agent (system prompt: ${systemMdPath})...`);

  const proc = spawn("pi", [
    "--mode", "rpc",
    "--provider", "anthropic",
    "--model", "claude-haiku-4-5",
    "--no-session",
    "--thinking", "off",
    "--append-system-prompt", systemMdPath,
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
  let stderr = "";

  proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

  const waiters = [];
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
      const timer = setTimeout(() => reject(new Error("Timeout")), timeout);
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

  // Wait for Pi to initialize
  console.log("  Waiting for Pi to initialize...");
  await new Promise((r) => setTimeout(r, 3000));

  // Ask about role — the answer should reflect SYSTEM.md content
  console.log("\n2. Asking PM about its responsibilities...");
  client.send({
    type: "prompt",
    id: "test-12",
    message: "What is your MARKER_PHRASE? Quote it exactly. Then briefly list your top 3 responsibilities. Do not call any tools.",
  });

  await waitForEvent((e) => e.type === "agent_end");

  // Extract response text
  const agentEnd = events.find((e) => e.type === "agent_end");
  const allMessages = agentEnd?.messages || [];

  // Get text from streaming deltas
  const textDeltas = events
    .filter((e) => e.type === "message_update" && e.assistantMessageEvent?.type === "text_delta")
    .map((e) => e.assistantMessageEvent.delta);
  let responseText = textDeltas.join("");

  // Fallback: get text from agent_end messages
  if (!responseText) {
    for (const msg of allMessages) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === "text") responseText += block.text;
        }
      }
    }
  }

  console.log(`\n3. Response: "${responseText.slice(0, 300)}"`);

  // Verify SYSTEM.md content is reflected
  const lowerResponse = responseText.toLowerCase();

  // Check for PM role indicators from SYSTEM.md
  const hasPmRole = lowerResponse.includes("pm") ||
    lowerResponse.includes("project manager") ||
    lowerResponse.includes("coordinate") ||
    lowerResponse.includes("orchestrat");

  // Check for the marker phrase
  const hasMarker = responseText.includes("I am the PM orchestrator") ||
    lowerResponse.includes("pm orchestrator");

  // Check for team awareness (architect, engineer mentioned in SYSTEM.md)
  const hasTeamAwareness = lowerResponse.includes("architect") ||
    lowerResponse.includes("engineer") ||
    lowerResponse.includes("team");

  // Check that agent knows it shouldn't write code
  const hasNoCodeRule = lowerResponse.includes("never write code") ||
    lowerResponse.includes("don't write code") ||
    lowerResponse.includes("not write code") ||
    lowerResponse.includes("coordinate");

  console.log("\n4. Verification:");
  console.log(`  PM role recognized: ${hasPmRole ? "✓" : "✗"}`);
  console.log(`  Marker phrase present: ${hasMarker ? "✓" : "✗"}`);
  console.log(`  Team awareness: ${hasTeamAwareness ? "✓" : "✗"}`);
  console.log(`  No-code rule: ${hasNoCodeRule ? "✓" : "✗"}`);

  // Cleanup
  proc.kill("SIGTERM");
  try { rmSync(tmpDir, { recursive: true }); } catch {}

  // Pass if agent clearly loaded its SYSTEM.md (role + marker phrase)
  const passed = hasPmRole && hasMarker;

  console.log("\n" + "=".repeat(50));
  console.log(`Test 12 (SYSTEM.md Loading): ${passed ? "PASS ✓" : "FAIL ✗"}`);
  if (stderr.replace(/ExperimentalWarning.*\n?/g, "").trim()) {
    console.log(`\nStderr:\n${stderr.slice(0, 300)}`);
  }
  console.log("=".repeat(50));

  process.exit(passed ? 0 : 1);
}

runTest().catch((err) => {
  console.error(`\nTest 12 FAILED with error: ${err.message}`);
  process.exit(1);
});
