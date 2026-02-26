#!/usr/bin/env node
/**
 * Background poller for idle agents.
 *
 * First checks SQLite for existing unread messages (instant exit if found).
 * Then creates a named pipe (FIFO) and blocks on read — zero CPU, instant wake-up.
 * The broker writes to the FIFO after inserting a message into SQLite.
 * Falls back to SQLite polling if the FIFO can't be created.
 *
 * Uses a PID lock file (/tmp/cc-poller-<agent-id>-<session-id>.lock) to prevent duplicate
 * pollers. If an existing poller is alive, this instance exits immediately.
 *
 * Usage:
 *   wait-for-messages --agent <agent-id> --session <session-id> [--timeout <seconds>]
 *
 * Environment variables (fallbacks):
 *   AGENT_ID         - Agent ID
 *   SESSION_ID       - Session ID
 *   ORCHESTRATOR_DIR - Path to orchestrator root (contains data/messages.db)
 */

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import {
  writeFileSync, readFileSync, unlinkSync, existsSync
} from 'node:fs'
import { open } from 'node:fs/promises'
import { execSync } from 'node:child_process'

// Parse arguments
const args = process.argv.slice(2)
let agentId = process.env.AGENT_ID
let sessionId = process.env.SESSION_ID
let timeoutSeconds = 300

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--agent' && args[i + 1]) {
    agentId = args[i + 1]
    i++
  } else if (args[i] === '--session' && args[i + 1]) {
    sessionId = args[i + 1]
    i++
  } else if (args[i] === '--timeout' && args[i + 1]) {
    timeoutSeconds = parseInt(args[i + 1], 10)
    i++
  }
}

const orchestratorDir = process.env.ORCHESTRATOR_DIR

if (!agentId || !sessionId || !orchestratorDir) {
  console.error('Missing required: --agent, --session, and ORCHESTRATOR_DIR env var')
  process.exit(1)
}

// PID lock file to prevent duplicate pollers
// Include sessionId to avoid collisions between concurrent projects
const lockFile = `/tmp/cc-poller-${agentId}-${sessionId}.lock`
const fifoPath = `/tmp/cc-wake-${agentId}-${sessionId}`

function isPollerAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Check for existing poller
if (existsSync(lockFile)) {
  try {
    const existingPid = parseInt(readFileSync(lockFile, 'utf8').trim(), 10)
    if (existingPid && isPollerAlive(existingPid)) {
      console.log(`Poller already running (PID ${existingPid})`)
      process.exit(0)
    }
    unlinkSync(lockFile)
  } catch {
    try { unlinkSync(lockFile) } catch { /* ignore */ }
  }
}

// Write our PID lock
writeFileSync(lockFile, String(process.pid))

// Clean exit — always remove lock file and FIFO
function cleanup() {
  try { unlinkSync(lockFile) } catch { /* ignore */ }
  try { unlinkSync(fifoPath) } catch { /* ignore */ }
}

function exit(code) {
  cleanup()
  process.exit(code)
}

process.on('SIGTERM', () => exit(0))
process.on('SIGINT', () => exit(0))

// Set up DB query targets
const baseRole = agentId.replace(/-\d+$/, '')
const targets = [agentId, 'team']
if (baseRole !== agentId) {
  targets.push(baseRole)
}

const dbPath = join(orchestratorDir, 'data', 'messages.db')
const placeholders = targets.map(() => '?').join(',')

// Check for existing unread messages
function checkDbForMessages() {
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const row = db.prepare(`
      SELECT COUNT(*) as count
      FROM messages
      WHERE session_id = ?
        AND to_agent IN (${placeholders})
        AND read = 0
    `).get(sessionId, ...targets)
    db.close()
    return row.count > 0
  } catch {
    return false
  }
}

// Immediate check — if messages already exist, exit right away
if (checkDbForMessages()) {
  console.log(`Messages pending for ${agentId}`)
  exit(0)
}

// Create FIFO (named pipe) for instant wake-up from broker
function createFifo() {
  try { unlinkSync(fifoPath) } catch { /* ignore */ }
  try {
    execSync(`mkfifo "${fifoPath}"`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const hasFifo = createFifo()

if (hasFifo) {
  // FIFO mode: block on read indefinitely, instant wake-up from broker.
  // No timeout needed — FIFO read uses zero CPU while blocked, and the broker
  // writes to it as soon as a message arrives. A timeout would just cause
  // unnecessary restart loops that burn API turns.
  try {
    const fd = await open(fifoPath, 'r')
    const buf = Buffer.alloc(64)
    await fd.read(buf, 0, 64)
    await fd.close()

    console.log(`Messages pending for ${agentId}`)
    exit(0)
  } catch {
    exit(0)
  }
} else {
  // Fallback: SQLite polling (if mkfifo not available)
  let db
  try {
    db = new DatabaseSync(dbPath, { readOnly: true })
  } catch (err) {
    console.error(`Cannot open database: ${err.message}`)
    exit(1)
  }

  const stmt = db.prepare(`
    SELECT COUNT(*) as count
    FROM messages
    WHERE session_id = ?
      AND to_agent IN (${placeholders})
      AND read = 0
  `)

  const POLL_INTERVAL_MS = 2000
  const startTime = Date.now()
  const timeoutMs = timeoutSeconds * 1000

  function poll() {
    try {
      const row = stmt.get(sessionId, ...targets)
      if (row.count > 0) {
        console.log(`Messages pending for ${agentId}`)
        try { db.close() } catch { /* ignore */ }
        exit(0)
      }
    } catch {
      // DB might be locked — retry
    }

    if (Date.now() - startTime > timeoutMs) {
      console.log(`No messages after ${timeoutSeconds}s timeout`)
      try { db.close() } catch { /* ignore */ }
      exit(1)
    }

    setTimeout(poll, POLL_INTERVAL_MS)
  }

  poll()
}
