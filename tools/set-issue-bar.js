#!/usr/bin/env node

/**
 * Set the issue bar summary in the dashboard
 *
 * Usage: set-issue-bar "<summary>" [--issue <num>]
 *
 * Options:
 *   --issue <num>  Link to a GitHub issue (fetches title/URL, renames sessions)
 *
 * Examples:
 *   set-issue-bar "Fix authorization fetch"
 *   set-issue-bar "Add OAuth flow" --issue 42
 *   set-issue-bar --issue 42  (uses issue title as summary)
 */

import { io } from 'socket.io-client'
import { execSync } from 'child_process'

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'
const SESSION_ID = process.env.BROKER_SESSION_ID || process.env.SESSION_ID || 'default'
const AGENT_ID = process.env.AGENT_ID || 'pm'

// Parse arguments
const args = process.argv.slice(2)
let summary = ''
let issueNum = null

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--issue' && args[i + 1]) {
    issueNum = args[i + 1]
    i++ // Skip the issue number
  } else if (!args[i].startsWith('--')) {
    // Accumulate non-flag arguments as summary
    summary = summary ? `${summary} ${args[i]}` : args[i]
  }
}

// Validate: need either summary or issue
if (!summary && !issueNum) {
  console.error(`
Usage: set-issue-bar "<summary>" [--issue <num>]

Sets the issue bar summary displayed in the dashboard.
Keep summaries concise (~8 words).

Options:
  --issue <num>  Link to a GitHub issue (fetches title/URL, renames sessions)

Examples:
  set-issue-bar "Fix authorization fetch"
  set-issue-bar "Add OAuth flow" --issue 42
  set-issue-bar --issue 42  (uses issue title as summary)
`)
  process.exit(1)
}

// If issue provided, fetch info from GitHub and get branch name
let issueTitle = null
let issueUrl = null
let worktreeName = null

if (issueNum) {
  // Fetch issue info from GitHub
  try {
    const ghOutput = execSync(`gh issue view ${issueNum} --json title,url`, { encoding: 'utf8' })
    const ghData = JSON.parse(ghOutput)
    issueTitle = ghData.title
    issueUrl = ghData.url
  } catch (err) {
    console.warn(`Warning: Could not fetch issue info from GitHub: ${err.message}`)
    // Continue anyway - we can still set the issue number
  }

  // User's custom summary overrides GitHub title for display
  // If no summary provided, fall back to GitHub title
  if (summary) {
    issueTitle = summary
  } else if (issueTitle) {
    summary = issueTitle
  }

  // Get current branch name as worktree name
  try {
    worktreeName = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim()
  } catch (err) {
    console.warn(`Warning: Could not get git branch: ${err.message}`)
    worktreeName = 'unknown'
  }
}

// Connect to broker (transient connection)
const socket = io(BROKER_URL, {
  query: { agent: AGENT_ID, sessionId: SESSION_ID, transient: 'true' },
  timeout: 5000
})

socket.on('connect', () => {
  if (issueNum) {
    // With --issue: emit rename_sessions (sets issue metadata + renames agent sessions)
    socket.emit('rename_sessions', {
      issueNum,
      worktreeName,
      issueTitle,
      issueUrl
    }, (response) => {
      if (response?.success) {
        console.log(`Issue bar linked to #${issueNum}: ${summary || '(no title)'}`)
        console.log(`Sessions renamed: ${response.agentCount} agents`)
        if (issueUrl) console.log(`URL: ${issueUrl}`)
      } else {
        console.error('Failed to link issue:', response?.error || 'Unknown error')
      }
      socket.disconnect()
      process.exit(response?.success ? 0 : 1)
    })
  } else {
    // Without --issue: just set summary text (current behavior)
    socket.emit('set_task_summary', { summary }, (response) => {
      if (response?.success) {
        console.log(`Issue bar updated: ${summary}`)
        process.exit(0)
      } else {
        console.error('Failed to update issue bar:', response?.error || 'Unknown error')
        process.exit(1)
      }
    })
  }
})

socket.on('connect_error', (err) => {
  console.error(`Failed to connect to broker at ${BROKER_URL}:`, err.message)
  process.exit(1)
})

// Timeout after 5 seconds
setTimeout(() => {
  console.error('Timeout waiting for broker response')
  socket.disconnect()
  process.exit(1)
}, 5000)
