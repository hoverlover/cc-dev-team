#!/usr/bin/env node

/**
 * Set the issue bar summary in the dashboard
 *
 * Usage: set-issue-bar.js <summary>
 *
 * Examples:
 *   set-issue-bar.js "Fix authorization fetch for auto-capture"
 *   set-issue-bar.js "Add dark mode to settings page"
 */

import { io } from 'socket.io-client'

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'
const SESSION_ID = process.env.SESSION_ID || 'default'
const AGENT_ID = process.env.AGENT_ID || 'pm'

const [,, ...summaryParts] = process.argv
const summary = summaryParts.join(' ')

if (!summary) {
  console.error(`
Usage: set-issue-bar "<summary>"

Sets the issue bar summary displayed in the dashboard.
Keep summaries concise (~8 words).

Examples:
  set-issue-bar "Fix authorization fetch for auto-capture"
  set-issue-bar "Add dark mode to settings page"
  set-issue-bar "Investigate slow dashboard load times"
`)
  process.exit(1)
}

// Connect to broker (transient connection)
const socket = io(BROKER_URL, {
  query: { agent: AGENT_ID, sessionId: SESSION_ID, transient: 'true' },
  timeout: 5000
})

socket.on('connect', () => {
  socket.emit('set_task_summary', { summary }, (response) => {
    if (response?.success) {
      console.log(`Issue bar updated: ${summary}`)
      process.exit(0)
    } else {
      console.error('Failed to update issue bar:', response?.error || 'Unknown error')
      process.exit(1)
    }
  })
})

socket.on('connect_error', (err) => {
  console.error(`Failed to connect to broker at ${BROKER_URL}:`, err.message)
  process.exit(1)
})

// Timeout after 5 seconds
setTimeout(() => {
  console.error('Timeout waiting for broker response')
  process.exit(1)
}, 5000)
