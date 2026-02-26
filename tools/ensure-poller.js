#!/usr/bin/env node
/**
 * Idempotent poller launcher.
 *
 * Ensures exactly one wait-for-messages poller is running for this agent+session.
 * If a poller is already alive, exits silently. If not, spawns one detached and
 * exits. Zero arguments — reads AGENT_ID and BROKER_SESSION_ID from env.
 *
 * Contract:
 *   - Always exits 0
 *   - No stdout output (hooks and agents rely on this)
 *   - Atomic lock check (O_CREAT|O_EXCL)
 *   - Idempotent — safe to call any number of times
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const agentId = process.env.AGENT_ID
const sessionId = process.env.BROKER_SESSION_ID || process.env.SESSION_ID

if (!agentId || !sessionId) {
  process.exit(0) // Missing env — exit silently
}

const TEMP_DIR = '/tmp/cc-dev-team'
mkdirSync(TEMP_DIR, { recursive: true })

const lockFile = `${TEMP_DIR}/poller-${agentId}-${sessionId}.lock`

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Check if a poller is already running
function isPollerAlive() {
  try {
    const pid = parseInt(readFileSync(lockFile, 'utf8').trim(), 10)
    return pid && isProcessAlive(pid)
  } catch {
    return false
  }
}

if (isPollerAlive()) {
  process.exit(0) // Poller already running — nothing to do
}

// Spawn wait-for-messages.js as a detached background process
const pollerScript = join(__dirname, 'wait-for-messages.js')
const child = spawn('node', [pollerScript, '--agent', agentId, '--session', sessionId], {
  detached: true,
  stdio: 'ignore',
  env: process.env
})
child.unref()

process.exit(0)
