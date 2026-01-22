import { io } from 'socket.io-client'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Get agent ID, agent directory, instance directory, and optional TTY from arguments
const agentId = process.argv[2]
const agentDir = process.argv[3] || process.cwd()
const instanceDir = process.argv[4] || join(agentDir, '.claude')
const agentTTY = process.argv[5] // TTY for stdin injection

if (!agentId) {
  console.error('Usage: node agent-listener.js <agent-id> [agent-dir] [instance-dir]')
  process.exit(1)
}

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'
const PENDING_FILE = join(instanceDir, 'pending-messages')
const PROJECT_FILE = join(instanceDir, 'project-dir')

// Ensure instance directory exists
mkdirSync(instanceDir, { recursive: true })

// Minimal startup logging
console.log(`[${agentId}] Connecting to broker...`)

const socket = io(BROKER_URL, {
  query: { agent: agentId },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: Infinity
})

socket.on('connect', () => {
  console.log(`[${agentId}] Ready`)
})

socket.on('disconnect', (reason) => {
  // Silent disconnect
})

socket.on('connect_error', (err) => {
  console.error(`[${agentId}] Connection error: ${err.message}`)
})

socket.on('message', (message) => {
  // Skip own messages sent to team
  if (message.to_agent === 'team' && message.from_agent === agentId) {
    return
  }

  // Silent message receipt - will prompt agent instead

  // Handle PROJECT_INIT specially
  if (message.message_type === 'PROJECT_INIT') {
    const content = typeof message.content === 'string'
      ? JSON.parse(message.content)
      : message.content

    writeFileSync(PROJECT_FILE, content.project_dir)
    // Silent - project context set
  }

  // Append to pending messages file
  let pending = []
  if (existsSync(PENDING_FILE)) {
    try {
      const content = readFileSync(PENDING_FILE, 'utf8')
      pending = JSON.parse(content)
    } catch (e) {
      pending = []
    }
  }

  pending.push({
    ...message,
    received_at: new Date().toISOString()
  })

  writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2))

  // Print notification to terminal
  console.log(`\n[${agentId}] >>> New message from ${message.from_agent}: ${message.message_type} <<<`)
})

// Team updates - silent for now, will show in dashboard later
socket.on('agent_joined', ({ role }) => {
  // Silent - dashboard will show this
})

socket.on('agent_left', ({ role }) => {
  // Silent - dashboard will show this
})

// Keep process alive - ready message already shown on connect

// Graceful shutdown - silent
process.on('SIGINT', () => {
  socket.disconnect()
  process.exit(0)
})

process.on('SIGTERM', () => {
  socket.disconnect()
  process.exit(0)
})
