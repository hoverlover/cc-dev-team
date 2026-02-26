#!/usr/bin/env node

/**
 * Rename all agent sessions in the current session
 *
 * Usage: rename-sessions.js <from> <issue-num> <worktree-name> [issue-title] [issue-url]
 *
 * This broadcasts a rename_session event to all agents, which will
 * rename their Claude Code sessions to: [agent-name]-[issue-num]-[worktree-name]
 *
 * If issue-title and issue-url are not provided, attempts to fetch from GitHub.
 *
 * Example:
 *   rename-sessions.js pm 123 feature-auth
 *   rename-sessions.js pm 123 feature-auth "Fix login bug" "https://github.com/org/repo/issues/123"
 */

import { io } from 'socket.io-client'
import { execSync } from 'child_process'

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'
const SESSION_ID = process.env.BROKER_SESSION_ID || process.env.SESSION_ID || 'default'

const [,, from, issueNum, worktreeName, issueTitle, issueUrl] = process.argv

if (!from || !issueNum || !worktreeName) {
  console.error(`
Usage: rename-sessions.js <from> <issue-num> <worktree-name> [issue-title] [issue-url]

Arguments:
  from          - Agent role making the request (e.g., pm)
  issue-num     - Issue number (e.g., 123)
  worktree-name - Worktree/branch name (e.g., feature-auth)
  issue-title   - (optional) Issue title, fetched from GitHub if not provided
  issue-url     - (optional) Issue URL, fetched from GitHub if not provided

Example:
  rename-sessions.js pm 123 feature-auth
`)
  process.exit(1)
}

// Fetch issue info from GitHub if not provided
let finalTitle = issueTitle
let finalUrl = issueUrl

if (!finalTitle || !finalUrl) {
  try {
    const ghOutput = execSync(`gh issue view ${issueNum} --json title,url`, { encoding: 'utf8' })
    const ghData = JSON.parse(ghOutput)
    finalTitle = finalTitle || ghData.title
    finalUrl = finalUrl || ghData.url
  } catch (err) {
    console.warn(`Warning: Could not fetch issue info from GitHub: ${err.message}`)
  }
}

// Connect to broker (transient connection)
const socket = io(BROKER_URL, {
  query: { agent: from, sessionId: SESSION_ID, transient: 'true' },
  timeout: 5000
})

socket.on('connect', () => {
  socket.emit('rename_sessions', {
    issueNum,
    worktreeName,
    issueTitle: finalTitle,
    issueUrl: finalUrl
  }, (response) => {
    if (response?.success) {
      console.log(`Sessions renamed: ${response.agentCount} agents notified`)
      console.log(`Format: [agent-name]-${issueNum}-${worktreeName}`)
      if (finalTitle) console.log(`Issue: ${finalTitle}`)
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
