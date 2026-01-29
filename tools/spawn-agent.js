#!/usr/bin/env node

/**
 * Spawn a new agent in the current session
 *
 * Usage: spawn-agent.js <role>
 *
 * Examples:
 *   spawn-agent.js engineer      # Spawns engineer-N (auto-numbered)
 *   spawn-agent.js architect
 *   spawn-agent.js qa-engineer
 */

import { io } from 'socket.io-client'

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'
const SESSION_ID = process.env.SESSION_ID
const AGENT_ROLE = process.env.AGENT_ROLE || 'pm'

const [,, role] = process.argv

if (!role) {
  console.error(`
Usage: spawn-agent.js <role>

Arguments:
  role - The agent role to spawn (engineer, architect, qa-engineer, ui-ux, code-auditor)

Note: 'engineer' will auto-assign the next available number (engineer-1, engineer-2, etc.)

Examples:
  spawn-agent.js engineer
  spawn-agent.js architect
`)
  process.exit(1)
}

if (!SESSION_ID) {
  console.error('Error: SESSION_ID environment variable not set')
  console.error('This tool must be run within a broker-managed session')
  process.exit(1)
}

// Connect to broker (transient connection)
const socket = io(BROKER_URL, {
  query: { agent: AGENT_ROLE, sessionId: SESSION_ID, transient: 'true' },
  timeout: 5000
})

socket.on('connect', () => {
  socket.emit('spawn_agent', { role }, (response) => {
    if (response.success) {
      console.log(`Spawned ${response.role} in session ${response.sessionId}`)
      process.exit(0)
    } else {
      console.error('Failed to spawn agent:', response.error)
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
