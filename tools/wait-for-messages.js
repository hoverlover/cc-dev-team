#!/usr/bin/env node
/**
 * Background poller for idle agents.
 *
 * First checks SQLite for existing unread messages (instant exit if found).
 * Then creates a named pipe (FIFO) and blocks on read — zero CPU, instant wake-up.
 * The broker writes to the FIFO after inserting a message into SQLite.
 * Falls back to SQLite polling if the FIFO can't be created.
 *
 * Uses a PID lock file (/tmp/cc-dev-team/poller-<agent-id>-<session-id>.lock) to prevent duplicate
 * pollers. If an existing poller is alive, this instance exits immediately.
 *
 * Usage:
 *   wait-for-messages --agent <agent-id> --session <session-id> [--timeout <seconds>] [--deliver]
 *
 * Environment variables (fallbacks):
 *   AGENT_ID           - Agent ID
 *   BROKER_SESSION_ID  - Broker's stable session ID (preferred)
 *   SESSION_ID         - Fallback session ID (may change on /resume)
 *   ORCHESTRATOR_DIR - Path to orchestrator root (contains data/messages.db)
 */

// Suppress Node.js ExperimentalWarning (SQLite) to keep output clean for subagents
const _origEmit = process.emit
process.emit = function (event, ...args) {
  if (event === 'warning' && args[0]?.name === 'ExperimentalWarning') return false
  return _origEmit.call(this, event, ...args)
}

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import {
  writeFileSync, readFileSync, unlinkSync, mkdirSync
} from 'node:fs'
import { open } from 'node:fs/promises'
import { execSync } from 'node:child_process'

// Parse arguments
const args = process.argv.slice(2)
let agentId = process.env.AGENT_ID
let sessionId = process.env.BROKER_SESSION_ID || process.env.SESSION_ID
let timeoutSeconds = 300
let deliverMode = false

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
  } else if (args[i] === '--deliver') {
    deliverMode = true
  }
}

const orchestratorDir = process.env.ORCHESTRATOR_DIR

if (!agentId || !sessionId || !orchestratorDir) {
  console.error('Missing required: --agent, --session, and ORCHESTRATOR_DIR env var')
  process.exit(1)
}

// Temp directory for all cc-dev-team temp files (FIFOs, lock files)
const TEMP_DIR = '/tmp/cc-dev-team'
mkdirSync(TEMP_DIR, { recursive: true })

// Track parent PID so we can detect orphaning.
// If our parent dies, we'll be reparented to PID 1 (init/launchd).
const parentPid = process.ppid

// PID lock file to prevent duplicate pollers
// Include sessionId to avoid collisions between concurrent projects
const lockFile = `${TEMP_DIR}/poller-${agentId}-${sessionId}.lock`
const fifoPath = `${TEMP_DIR}/wake-${agentId}-${sessionId}`

function isPollerAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Acquire PID lock — "last writer wins" strategy.
// If an existing poller is alive, kill it first. The newest invocation always
// takes over, since previous subagent contexts are gone and can't process results.
try {
  writeFileSync(lockFile, String(process.pid), { flag: 'wx' })
} catch (err) {
  if (err.code === 'EEXIST') {
    try {
      const existingPid = parseInt(readFileSync(lockFile, 'utf8').trim(), 10)
      if (existingPid && existingPid !== process.pid && isPollerAlive(existingPid)) {
        process.kill(existingPid, 'SIGTERM')
      }
    } catch { /* ignore — stale lock or already dead */ }
    // Remove stale lock and claim it
    try { unlinkSync(lockFile) } catch { /* ignore */ }
    try {
      writeFileSync(lockFile, String(process.pid), { flag: 'wx' })
    } catch (retryErr) {
      if (retryErr.code === 'EEXIST') {
        // Another process won the race — let it have it
        console.log('Poller already running (lost lock race)')
        process.exit(2)
      }
      throw retryErr
    }
  } else {
    throw err
  }
}

// Clean exit — remove lock file and FIFO only if we still own the lock.
// A newer poller may have already taken over, in which case deleting
// the FIFO would break the new poller's blocking read.
function cleanup() {
  try {
    const lockPid = parseInt(readFileSync(lockFile, 'utf8').trim(), 10)
    if (lockPid === process.pid) {
      try { unlinkSync(lockFile) } catch { /* ignore */ }
      try { unlinkSync(fifoPath) } catch { /* ignore */ }
    }
  } catch {
    // Lock file already gone — nothing to clean up
  }
}

// Track whether we're already exiting to prevent re-entrant cleanup
let exiting = false
function exit(code) {
  if (exiting) return
  exiting = true
  cleanup()
  process.exit(code)
}

process.on('SIGTERM', () => exit(0))
process.on('SIGINT', () => exit(0))
process.on('SIGHUP', () => exit(0))

// Orphan detection: if parent process dies, we get reparented to PID 1 (launchd).
// Check periodically and exit if orphaned — this catches cases where the Bash tool
// kills the shell but SIGHUP doesn't reach us.
const orphanCheck = setInterval(() => {
  if (process.ppid !== parentPid) {
    clearInterval(orphanCheck)
    exit(0)
  }
}, 5000)
orphanCheck.unref() // Don't keep process alive just for this check

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

// Deliver mode: query full messages, mark as read, output formatted text
function deliverMessages() {
  try {
    const db = new DatabaseSync(dbPath)
    db.exec('BEGIN IMMEDIATE')
    const rows = db.prepare(`
      SELECT id, from_agent, message_type, content
      FROM messages
      WHERE session_id = ?
        AND to_agent IN (${placeholders})
        AND read = 0
      ORDER BY id ASC
    `).all(sessionId, ...targets)

    if (rows.length > 0) {
      const ids = rows.map(r => r.id)
      const idPlaceholders = ids.map(() => '?').join(',')
      db.prepare(`UPDATE messages SET read = 1 WHERE id IN (${idPlaceholders})`).run(...ids)
      db.exec('COMMIT')
      db.close()

      const formatted = rows.map(r => {
        const content = String(r.content).replace(/\n/g, ' ').replace(/\r/g, '')
        return `[MESSAGE from ${r.from_agent}] [${r.message_type}]: ${content}`
      })
      console.log(`NEW TEAM MESSAGE(S): ${formatted.join(' | ')}`)
      return true
    }
    db.exec('COMMIT')
    db.close()
    return false
  } catch {
    return false
  }
}

// Immediate check — if messages already exist, exit right away
if (checkDbForMessages()) {
  if (deliverMode) {
    deliverMessages()
  } else {
    console.log(`Messages pending for ${agentId}`)
  }
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
  // FIFO mode: block on read with a timeout, instant wake-up from broker.
  // The timeout ensures orphaned processes don't live forever if the parent
  // dies without sending a signal (e.g., Bash tool timeout kills shell but
  // SIGHUP doesn't reach the node process).
  //
  // We use a hard timeout via process.exit because fd.read on a FIFO blocks
  // at the OS level and can't be cancelled via AbortController.
  const timeoutHandle = setTimeout(() => {
    console.log(`No messages after ${timeoutSeconds}s timeout (FIFO)`)
    exit(1)
  }, timeoutSeconds * 1000)
  try {
    const fd = await open(fifoPath, 'r')
    const buf = Buffer.alloc(64)
    await fd.read(buf, 0, 64)
    clearTimeout(timeoutHandle)
    await fd.close()

    if (deliverMode) {
      deliverMessages()
    } else {
      console.log(`Messages pending for ${agentId}`)
    }
    exit(0)
  } catch {
    clearTimeout(timeoutHandle)
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
        try { db.close() } catch { /* ignore */ }
        if (deliverMode) {
          deliverMessages()
        } else {
          console.log(`Messages pending for ${agentId}`)
        }
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
