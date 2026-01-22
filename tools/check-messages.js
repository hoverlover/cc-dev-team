#!/usr/bin/env node

/**
 * Check and display pending messages for an agent
 *
 * Usage: check-messages.js [agent-dir]
 *
 * Reads from .claude/pending-messages in the agent directory
 * and displays them in a readable format.
 *
 * Use --clear to also clear the pending messages after reading.
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'

const args = process.argv.slice(2)
const clearAfterRead = args.includes('--clear')
const agentDir = args.find(arg => !arg.startsWith('--')) || process.cwd()

const pendingFile = join(agentDir, '.claude', 'pending-messages')

if (!existsSync(pendingFile)) {
  console.log('No pending messages.')
  process.exit(0)
}

let messages
try {
  const content = readFileSync(pendingFile, 'utf8')
  messages = JSON.parse(content)
} catch (err) {
  console.error('Error reading pending messages:', err.message)
  process.exit(1)
}

if (!Array.isArray(messages) || messages.length === 0) {
  console.log('No pending messages.')
  if (clearAfterRead) {
    unlinkSync(pendingFile)
  }
  process.exit(0)
}

console.log(`\n${'='.repeat(60)}`)
console.log(`PENDING MESSAGES (${messages.length})`)
console.log('='.repeat(60))

for (const msg of messages) {
  const timestamp = new Date(msg.created_at || msg.received_at).toLocaleTimeString()
  const content = typeof msg.content === 'string'
    ? msg.content
    : JSON.stringify(msg.content, null, 2)

  console.log(`
┌─ ${msg.message_type} ─────────────────────────────────────
│ From: ${msg.from_agent}
│ To:   ${msg.to_agent}
│ Time: ${timestamp}
${msg.thread_id ? `│ Thread: ${msg.thread_id}\n` : ''}├────────────────────────────────────────────────────────
${content.split('\n').map(line => `│ ${line}`).join('\n')}
└────────────────────────────────────────────────────────`)
}

console.log('\n' + '='.repeat(60))

if (clearAfterRead) {
  unlinkSync(pendingFile)
  console.log('Messages cleared.')
} else {
  console.log('Use --clear to clear messages after reading.')
}
