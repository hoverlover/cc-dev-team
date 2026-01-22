#!/usr/bin/env node

/**
 * Send a message to another agent or the team
 *
 * Usage: send-message.js <from> <to> <type> <content>
 *
 * Examples:
 *   send-message.js pm team PROJECT_INIT '{"project_dir":"/code/myapp"}'
 *   send-message.js architect engineer-1 HANDOFF '{"task":"implement auth"}'
 *   send-message.js engineer-1 qa HANDOFF '{"feature":"oauth"}'
 */

import { io } from 'socket.io-client'

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'

const [,, from, to, type, contentStr, threadId] = process.argv

if (!from || !to || !type || !contentStr) {
  console.error(`
Usage: send-message.js <from> <to> <type> <content> [thread_id]

Arguments:
  from      - Sender agent role (pm, architect, engineer-1, engineer-2, qa)
  to        - Recipient (agent role or 'team' for broadcast)
  type      - Message type (PROJECT_INIT, TASK_ASSIGNMENT, QUESTION, etc.)
  content   - JSON string or plain text content
  thread_id - Optional thread ID for grouping related messages

Examples:
  send-message.js pm team PROJECT_INIT '{"project_dir":"/code/myapp"}'
  send-message.js architect engineer-1 QUESTION "Should we use Redis?"
  send-message.js qa engineer-1 BUG_REPORT '{"summary":"Token refresh fails"}'
`)
  process.exit(1)
}

// Parse content - try JSON first, fall back to plain string
let content
try {
  content = JSON.parse(contentStr)
} catch {
  content = contentStr
}

// Connect to broker (transient connection - won't register as a full agent)
const socket = io(BROKER_URL, {
  query: { agent: from, transient: 'true' },
  timeout: 5000
})

socket.on('connect', () => {
  // Send the message
  socket.emit('send_message', {
    to,
    type,
    content,
    threadId: threadId || null
  }, (response) => {
    if (response.success) {
      console.log(`Message sent: ${from} → ${to} [${type}]`)
      process.exit(0)
    } else {
      console.error('Failed to send message:', response.error)
      process.exit(1)
    }
  })
})

socket.on('connect_error', (err) => {
  console.error(`Failed to connect to broker at ${BROKER_URL}:`, err.message)
  console.error('Is the broker running? Start it with: npm run broker')
  process.exit(1)
})

// Timeout after 5 seconds
setTimeout(() => {
  console.error('Timeout waiting for broker response')
  process.exit(1)
}, 5000)
