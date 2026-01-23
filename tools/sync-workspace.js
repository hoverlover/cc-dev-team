#!/usr/bin/env node

/**
 * Sync workspace across all agents in the session
 *
 * Usage: sync-workspace.js <from> <action> <path>
 *
 * This broadcasts a workspace_sync event to all agents, which will
 * automatically `cd` to the specified path.
 *
 * Actions:
 *   switch - Switch to a new worktree/directory
 *   remove - Switch back (when removing a worktree)
 *
 * Example:
 *   sync-workspace.js engineer switch /path/to/worktree
 *   sync-workspace.js engineer remove /path/to/original/project
 */

import { io } from 'socket.io-client'

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'
const SESSION_ID = process.env.SESSION_ID || 'default'

const [,, from, action, path] = process.argv

if (!from || !action || !path) {
  console.error(`
Usage: sync-workspace.js <from> <action> <path>

Arguments:
  from   - Agent role making the request (e.g., engineer)
  action - "switch" (to new worktree) or "remove" (back to original)
  path   - Absolute path to the directory

Examples:
  sync-workspace.js engineer switch /Users/dev/project-worktree
  sync-workspace.js engineer remove /Users/dev/project
`)
  process.exit(1)
}

if (action !== 'switch' && action !== 'remove') {
  console.error('Error: action must be "switch" or "remove"')
  process.exit(1)
}

// Connect to broker (transient connection)
const socket = io(BROKER_URL, {
  query: { agent: from, sessionId: SESSION_ID, transient: 'true' },
  timeout: 5000
})

socket.on('connect', () => {
  socket.emit('sync_workspace', { path, action }, (response) => {
    if (response?.success) {
      console.log(`Workspace synced: ${response.agentCount} agents will switch to ${path}`)
    } else {
      console.error('Failed to sync workspace')
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
