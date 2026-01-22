#!/usr/bin/env node

/**
 * Get the next available instance ID for a given agent role.
 *
 * Usage: next-agent-id.js <role>
 *
 * Queries the broker for active agents and returns the next available ID.
 * For example, if engineer-1 and engineer-3 are running, returns "2".
 * If no engineers are running, returns "1".
 */

import { io } from 'socket.io-client'

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'
const role = process.argv[2]

if (!role) {
  console.error('Usage: next-agent-id.js <role>')
  process.exit(1)
}

const socket = io(BROKER_URL, {
  query: { agent: 'id-check' },
  timeout: 3000
})

socket.on('connect', () => {
  socket.emit('get_roster', (roster) => {
    // Find all agents matching the role pattern (e.g., engineer-1, engineer-2)
    const pattern = new RegExp(`^${role}-(\\d+)$`)
    const usedIds = roster
      .map(agent => {
        const match = agent.match(pattern)
        return match ? parseInt(match[1], 10) : null
      })
      .filter(id => id !== null)

    // Find the next available ID (fill gaps first, then append)
    let nextId = 1
    if (usedIds.length > 0) {
      usedIds.sort((a, b) => a - b)
      // Find first gap
      for (let i = 0; i < usedIds.length; i++) {
        if (usedIds[i] !== i + 1) {
          nextId = i + 1
          break
        }
        nextId = usedIds[i] + 1
      }
    }

    console.log(nextId)
    socket.disconnect()
    process.exit(0)
  })
})

socket.on('connect_error', () => {
  // Broker not running, default to 1
  console.log('1')
  process.exit(0)
})

setTimeout(() => {
  // Timeout, default to 1
  console.log('1')
  process.exit(0)
}, 3000)
