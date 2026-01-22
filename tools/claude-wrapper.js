#!/usr/bin/env node
/**
 * Claude Code PTY Wrapper
 *
 * Wraps Claude Code with a pseudo-terminal to enable message injection.
 * When messages arrive from the broker and input is idle, it injects
 * a prompt to check messages.
 */

import pty from '@lydell/node-pty-darwin-arm64'
import { io } from 'socket.io-client'
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

// Parse arguments
const args = process.argv.slice(2)
let agentId = null
let agentDir = process.cwd()
let instanceDir = null
let claudeArgs = []

// Extract our arguments before -- separator
let i = 0
while (i < args.length) {
  if (args[i] === '--agent-id' && args[i + 1]) {
    agentId = args[i + 1]
    i += 2
  } else if (args[i] === '--agent-dir' && args[i + 1]) {
    agentDir = args[i + 1]
    i += 2
  } else if (args[i] === '--instance-dir' && args[i + 1]) {
    instanceDir = args[i + 1]
    i += 2
  } else if (args[i] === '--') {
    claudeArgs = args.slice(i + 1)
    break
  } else {
    claudeArgs.push(args[i])
    i++
  }
}

if (!agentId) {
  console.error('Usage: claude-wrapper.js --agent-id <id> [--agent-dir <dir>] [--instance-dir <dir>] [-- claude args...]')
  process.exit(1)
}

if (!instanceDir) {
  instanceDir = join(agentDir, '.claude', 'instances', agentId)
}

// Ensure instance directory exists
mkdirSync(instanceDir, { recursive: true })

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'
const PENDING_FILE = join(instanceDir, 'pending-messages')
const PROJECT_FILE = join(instanceDir, 'project-dir')

// Input tracking - monitors if the input line is empty
class InputTracker {
  constructor() {
    this.buffer = []
    this.lastKeystroke = Date.now()
    this.inEscSeq = false
    this.escSeqStart = 0
  }

  processByte(b) {
    // Handle escape sequences
    if (b === 0x1b) { // ESC
      this.inEscSeq = true
      this.escSeqStart = Date.now()
      return
    }

    if (this.inEscSeq) {
      // Escape sequences timeout after 100ms
      if (Date.now() - this.escSeqStart > 100) {
        this.inEscSeq = false
      } else if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 126) {
        // Letter or ~ terminates escape sequence
        this.inEscSeq = false
        return
      } else {
        return
      }
    }

    this.lastKeystroke = Date.now()

    if (b === 13 || b === 10) { // Enter - clear buffer
      this.buffer = []
    } else if (b === 127 || b === 8) { // Backspace/Delete
      this.buffer.pop()
    } else if (b === 21) { // Ctrl+U - clear line
      this.buffer = []
    } else if (b === 3) { // Ctrl+C - clear buffer
      this.buffer = []
    } else if (b === 23) { // Ctrl+W - delete word
      while (this.buffer.length > 0 && this.buffer[this.buffer.length - 1] !== 32) {
        this.buffer.pop()
      }
    } else if (b >= 32 && b < 127) { // Printable character
      this.buffer.push(b)
    }
  }

  canInject(idleTimeoutMs = 2000) {
    return this.buffer.length === 0 && (Date.now() - this.lastKeystroke) > idleTimeoutMs
  }
}

// Find Claude executable
let claudePath
try {
  claudePath = execSync('which claude', { encoding: 'utf8' }).trim()
} catch {
  claudePath = process.env.CLAUDE_PATH || '/Users/cboyd/.local/bin/claude'
}

// Create PTY with Claude
const ptyProcess = pty.spawn(claudePath, claudeArgs, {
  name: 'xterm-256color',
  cols: process.stdout.columns || 80,
  rows: process.stdout.rows || 24,
  cwd: agentDir,
  env: {
    ...process.env,
    AGENT_ID: agentId,
    INSTANCE_DIR: instanceDir
  }
})

const tracker = new InputTracker()
let lastInjected = 0
const COOLDOWN_MS = 60000 // 60 seconds between injections
const CHECK_INTERVAL_MS = 5000 // Check for messages every 5 seconds
const IDLE_TIMEOUT_MS = 2000 // Must be idle for 2 seconds

// Handle terminal resize
process.stdout.on('resize', () => {
  ptyProcess.resize(process.stdout.columns, process.stdout.rows)
})

// Forward PTY output to stdout
ptyProcess.onData((data) => {
  process.stdout.write(data)
})

// Forward stdin to PTY with tracking
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
}
process.stdin.resume()
process.stdin.on('data', (data) => {
  for (const byte of data) {
    tracker.processByte(byte)
  }
  ptyProcess.write(data)
})

// Handle PTY exit
ptyProcess.onExit(({ exitCode }) => {
  process.exit(exitCode)
})

// Connect to broker
const socket = io(BROKER_URL, {
  query: { agent: agentId },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: Infinity
})

socket.on('connect', () => {
  // Silent connection - don't interfere with Claude's terminal
})

socket.on('message', (message) => {
  // Skip own messages sent to team
  if (message.to_agent === 'team' && message.from_agent === agentId) {
    return
  }

  // Handle PROJECT_INIT specially
  if (message.message_type === 'PROJECT_INIT') {
    const content = typeof message.content === 'string'
      ? JSON.parse(message.content)
      : message.content
    writeFileSync(PROJECT_FILE, content.project_dir)
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
})

// Message injection function
function inject(text) {
  // Write text and enter all at once
  ptyProcess.write(text + '\r')
}

// Check for pending messages and inject if appropriate
function checkAndInject() {
  // Check cooldown
  if ((Date.now() - lastInjected) < COOLDOWN_MS) {
    return
  }

  // Check for pending messages
  if (!existsSync(PENDING_FILE)) {
    return
  }

  let pending = []
  try {
    const content = readFileSync(PENDING_FILE, 'utf8')
    pending = JSON.parse(content)
  } catch (e) {
    return
  }

  if (pending.length === 0) {
    return
  }

  // Check if we can safely inject
  if (!tracker.canInject(IDLE_TIMEOUT_MS)) {
    return
  }

  // Inject the prompt - be very explicit about what to do
  const prompt = `URGENT: New team messages arrived. Use the Read tool to read ${PENDING_FILE} now and respond to each message.`
  inject(prompt)
  lastInjected = Date.now()
}

// Start message checking interval
setInterval(checkAndInject, CHECK_INTERVAL_MS)

// Handle graceful shutdown
process.on('SIGINT', () => {
  socket.disconnect()
  ptyProcess.kill()
})

process.on('SIGTERM', () => {
  socket.disconnect()
  ptyProcess.kill()
})
