#!/usr/bin/env node

/**
 * Rename all agent sessions in the current session
 *
 * Usage: rename-sessions.js <from> <issue-num> <worktree-name>
 *
 * This broadcasts a rename_session event to all agents, which will
 * rename their Claude Code sessions to: [agent-name]-[issue-num]-[worktree-name]
 *
 * Example:
 *   rename-sessions.js pm 123 feature-auth
 *   -> pm session becomes: pm-123-feature-auth
 *   -> architect session becomes: architect-123-feature-auth
 *   -> etc.
 */

import { io } from 'socket.io-client'

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'
const SESSION_ID = process.env.SESSION_ID || 'default'

const [,, from, issueNum, worktreeName] = process.argv

if (!from || !issueNum || !worktreeName) {
  console.error(`
Usage: rename-sessions.js <from> <issue-num> <worktree-name>

Arguments:
  from          - Agent role making the request (e.g., pm)
  issue-num     - Issue number (e.g., 123)
  worktree-name - Worktree/branch name (e.g., feature-auth)

Example:
  rename-sessions.js pm 123 feature-auth
`)
  process.exit(1)
}

// Connect to broker (transient connection)
const socket = io(BROKER_URL, {
  query: { agent: from, sessionId: SESSION_ID, transient: 'true' },
  timeout: 5000
})

socket.on('connect', () => {
  socket.emit('rename_sessions', { issueNum, worktreeName }, (response) => {
    if (response?.success) {
      console.log(`Sessions renamed: ${response.agentCount} agents notified`)
      console.log(`Format: [agent-name]-${issueNum}-${worktreeName}`)
    } else {
      console.error('Failed to rename sessions')
    }
    socket.disconnect()
    process.exit(response?.success ? 0 : 1)
  })
})

socket.on('connect_error', (err) => {
  console.error(`Failed to connect to broker: ${err.message}`)
  process.exit(1)
})

// Timeout if no response
setTimeout(() => {
  console.error('Timeout waiting for broker response')
  socket.disconnect()
  process.exit(1)
}, 10000)
