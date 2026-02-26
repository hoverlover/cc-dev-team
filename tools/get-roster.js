#!/usr/bin/env node

/**
 * Get the current roster of active agents
 *
 * Usage: get-roster.js
 */

import { io } from 'socket.io-client'

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'
const SESSION_ID = process.env.BROKER_SESSION_ID || process.env.SESSION_ID

if (!SESSION_ID) {
  console.error('SESSION_ID environment variable is required')
  process.exit(1)
}

const socket = io(BROKER_URL, {
  query: { agent: 'roster-check', sessionId: SESSION_ID, transient: 'true' },
  timeout: 5000
})

socket.on('connect', () => {
  socket.emit('get_roster', (roster) => {
    console.log('\n' + '='.repeat(40))
    console.log('ACTIVE AGENTS')
    console.log('='.repeat(40))

    if (roster.length === 0) {
      console.log('\nNo agents currently connected.')
    } else {
      for (const agent of roster) {
        // Get icon based on base role (handle numbered agents like engineer-1)
        const baseRole = agent.replace(/-\d+$/, '')
        const icon = {
          'pm': '👔',
          'architect': '🏗️',
          'engineer': '⚙️',
          'qa-engineer': '🧪',
          'ui-ux': '🎨',
          'code-auditor': '🔍',
          'docs-auditor': '📝'
        }[baseRole] || '🤖'

        console.log(`  ${icon}  ${agent}`)
      }
      console.log(`\nTotal: ${roster.length} agent(s)`)
    }

    console.log('='.repeat(40) + '\n')

    socket.disconnect()
    process.exit(0)
  })
})

socket.on('connect_error', (err) => {
  console.error(`Failed to connect to broker at ${BROKER_URL}:`, err.message)
  console.error('Is the broker running? Start it with: npm run broker')
  process.exit(1)
})

setTimeout(() => {
  console.error('Timeout waiting for broker response')
  process.exit(1)
}, 5000)
