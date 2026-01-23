#!/usr/bin/env node
/**
 * Claude Code PTY Wrapper
 *
 * Wraps Claude Code with a pseudo-terminal for the orchestrator.
 * Supports two modes:
 * - Interactive (default): Output to local terminal, input from stdin
 * - Headless (--headless): Output to broker only, input from broker/dashboard
 *
 * In headless mode, the dashboard becomes the terminal interface.
 */

import pty from '@lydell/node-pty-darwin-arm64'
import { io } from 'socket.io-client'
import { writeFileSync, appendFileSync, mkdirSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { execSync } from 'child_process'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOG_DIR = join(__dirname, '..', 'logs')
mkdirSync(LOG_DIR, { recursive: true })

// Fixed terminal size for headless mode (must match dashboard xterm.js)
const HEADLESS_COLS = 120
const HEADLESS_ROWS = 40

// Debug logging to file
let logAgentId = 'unknown'
function debug(msg) {
  const timestamp = new Date().toISOString()
  const logFile = join(LOG_DIR, `wrapper-${logAgentId}.log`)
  try {
    appendFileSync(logFile, `${timestamp} ${msg}\n`)
  } catch (e) {
    // Ignore logging errors
  }
}

// Parse arguments (with environment variable fallbacks for broker-spawned agents)
const args = process.argv.slice(2)
let agentId = process.env.AGENT_ROLE || null
let agentDir = process.env.PROJECT_DIR || process.cwd()  // Agent runs in project directory
let instanceDir = null
let headless = process.env.HEADLESS === 'true'
let sessionId = process.env.SESSION_ID || 'default'
let agentSystemPromptPath = process.env.AGENT_SYSTEM_PROMPT || null  // Path to agent's CLAUDE.md
let agentSettingsPath = process.env.AGENT_SETTINGS || null  // Path to agent's settings.json
let claudeArgs = []

let i = 0
while (i < args.length) {
  if (args[i] === '--agent-id' && args[i + 1]) {
    agentId = args[i + 1]
    i += 2
  } else if (args[i] === '--agent-dir' && args[i + 1]) {
    agentDir = args[i + 1]
    i += 2
  } else if (args[i] === '--agent-system-prompt' && args[i + 1]) {
    agentSystemPromptPath = args[i + 1]
    i += 2
  } else if (args[i] === '--agent-settings' && args[i + 1]) {
    agentSettingsPath = args[i + 1]
    i += 2
  } else if (args[i] === '--instance-dir' && args[i + 1]) {
    instanceDir = args[i + 1]
    i += 2
  } else if (args[i] === '--session-id' && args[i + 1]) {
    sessionId = args[i + 1]
    i += 2
  } else if (args[i] === '--headless') {
    headless = true
    i++
  } else if (args[i] === '--') {
    claudeArgs = args.slice(i + 1)
    break
  } else {
    claudeArgs.push(args[i])
    i++
  }
}

if (!agentId) {
  console.error('Usage: claude-wrapper.js --agent-id <id> [--headless] [--session-id <id>] [--agent-dir <dir>] [--instance-dir <dir>] [-- claude args...]')
  console.error('Or set environment variables: AGENT_ROLE, SESSION_ID, PROJECT_DIR, HEADLESS')
  process.exit(1)
}

logAgentId = agentId
debug(`Starting wrapper for agent: ${agentId}, session: ${sessionId}, headless: ${headless}`)
debug(`Working directory: ${agentDir}`)
if (agentSystemPromptPath) debug(`Agent system prompt: ${agentSystemPromptPath}`)
if (agentSettingsPath) debug(`Agent settings: ${agentSettingsPath}`)

if (!instanceDir) {
  instanceDir = join(agentDir, '.claude', 'instances', agentId)
}

mkdirSync(instanceDir, { recursive: true })

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'
const PROJECT_FILE = join(instanceDir, 'project-dir')

// Message queue for team message injection
const messageQueue = []

// Status tracking - parsed from output
let currentStatus = 'idle'
let currentTask = ''
let waitingForInput = false

// Patterns to detect status from Claude Code output
const STATUS_PATTERNS = {
  // Whimsical thinking indicators with full task description
  // Captures: "* Adding settings UI toggle... (esc to interrupt)" → "Adding settings UI toggle"
  thinkingWhimsical: /[*✱]\s*(.+?)\.{3}\s*\(esc to interrupt\)/i,
  thinking: /[●•]\s*Thinking|Thinking\.\.\./i,
  toolUse: /[●•]\s*(Bash|Read|Edit|Write|Glob|Grep|Task|WebFetch|WebSearch|TodoWrite|NotebookEdit)\s*\(/i,
  waiting: /Waiting\.\.\.|waiting for|Press enter/i,
  // Permission/input prompts - must be specific patterns, not just keywords
  // Look for actual prompt structures: numbered menu options, (y/n) prompts, etc.
  permission: /Do you want to proceed\?\s*$|^\s*❯?\s*\d+\.\s*(Yes|No|Allow|Deny)|allow this action|deny this action|\(y\/n\)\s*$|\[y\/N\]\s*$|\[Y\/n\]\s*$/im,
  // Brewed/completed indicator
  complete: /[*✱]\s*Brewed for|[*✱]\s*Cooked for|[✓✔]\s*|Done|Complete/i,
  // Detect when Claude shows the input prompt (idle state) - the ❯ character or > followed by space/end
  // But NOT when it's a menu selection like "❯ 1. Yes"
  idle: /[\r\n][❯>]\s*$/,
}

// Parse output for status updates
function parseStatusFromOutput(data) {
  // Get only the last portion of output for status detection (last ~500 chars)
  // This prevents old output from triggering false positives
  const recentData = data.length > 500 ? data.slice(-500) : data

  // Check for idle prompt FIRST - this is the most definitive state
  // The ❯ or > prompt at end means Claude is ready for input (not waiting for permission)
  if (STATUS_PATTERNS.idle.test(recentData) && !/❯\s*\d+\./.test(recentData)) {
    waitingForInput = false
    currentStatus = 'idle'
    currentTask = ''
    debug(`Detected idle prompt`)
    return { status: 'idle', task: '', waitingForInput: false }
  }

  // Check for whimsical thinking indicators with full task description
  // e.g., "* Adding settings UI toggle... (esc to interrupt)" → "Adding settings UI toggle..."
  const whimsicalMatch = recentData.match(STATUS_PATTERNS.thinkingWhimsical)
  if (whimsicalMatch) {
    waitingForInput = false
    currentStatus = 'thinking'
    currentTask = whimsicalMatch[1].trim() + '...'  // Full task description
    debug(`Detected whimsical thinking: ${currentTask}`)
    return { status: 'thinking', task: currentTask, waitingForInput: false }
  }

  // Check for tool use
  const toolMatch = recentData.match(STATUS_PATTERNS.toolUse)
  if (toolMatch) {
    waitingForInput = false
    currentStatus = 'working'
    currentTask = toolMatch[0].replace(/[●•]\s*/, '').trim()
    return { status: 'working', task: currentTask, waitingForInput: false }
  }

  // Check for thinking
  if (STATUS_PATTERNS.thinking.test(recentData)) {
    waitingForInput = false
    currentStatus = 'thinking'
    currentTask = 'Thinking...'
    return { status: 'thinking', task: currentTask, waitingForInput: false }
  }

  // Check for permission prompt - only after ruling out idle/working states
  // Must match specific prompt patterns, not just keywords
  if (STATUS_PATTERNS.permission.test(recentData)) {
    waitingForInput = true
    currentStatus = 'waiting_input'
    debug(`Detected permission prompt - waiting for input`)
    return { status: 'waiting_input', task: 'Permission required', waitingForInput: true }
  }

  // Check for completion (Brewed for..., Cooked for...)
  if (STATUS_PATTERNS.complete.test(recentData)) {
    // Don't immediately set to idle - wait for the prompt
    debug(`Detected completion`)
    return null
  }

  // Check for waiting
  if (STATUS_PATTERNS.waiting.test(recentData)) {
    currentStatus = 'waiting'
    return { status: 'waiting', task: currentTask, waitingForInput: false }
  }

  return null
}

// Input tracking for message injection timing
class InputTracker {
  constructor() {
    this.buffer = []
    this.lastKeystroke = Date.now()
    this.inEscSeq = false
    this.escSeqStart = 0
  }

  processByte(b) {
    if (b === 0x1b) {
      this.inEscSeq = true
      this.escSeqStart = Date.now()
      return
    }

    if (this.inEscSeq) {
      if (Date.now() - this.escSeqStart > 100) {
        this.inEscSeq = false
      } else if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 126) {
        this.inEscSeq = false
        return
      } else {
        return
      }
    }

    this.lastKeystroke = Date.now()

    if (b === 13 || b === 10) {
      this.buffer = []
    } else if (b === 127 || b === 8) {
      this.buffer.pop()
    } else if (b === 21) {
      this.buffer = []
    } else if (b === 3) {
      this.buffer = []
    } else if (b === 23) {
      while (this.buffer.length > 0 && this.buffer[this.buffer.length - 1] !== 32) {
        this.buffer.pop()
      }
    } else if (b >= 32 && b < 127) {
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

// Determine terminal size
const cols = headless ? HEADLESS_COLS : (process.stdout.columns || 120)
const rows = headless ? HEADLESS_ROWS : (process.stdout.rows || 40)

debug(`Creating PTY with size ${cols}x${rows}`)

// Resolve @/path/to/file includes in CLAUDE.md content
function resolveIncludes(content, basePath) {
  // Match @/absolute/path or @relative/path patterns
  const includePattern = /@([^\s\n]+)/g
  return content.replace(includePattern, (match, filePath) => {
    try {
      // Handle absolute paths
      let resolvedPath = filePath
      if (!filePath.startsWith('/')) {
        // Relative path - resolve from basePath
        resolvedPath = join(dirname(basePath), filePath)
      }

      if (existsSync(resolvedPath)) {
        const includedContent = readFileSync(resolvedPath, 'utf8')
        debug(`Resolved include: ${filePath} (${includedContent.length} chars)`)
        return includedContent
      } else {
        debug(`Include file not found: ${resolvedPath}`)
        return match // Keep original if file not found
      }
    } catch (err) {
      debug(`Failed to resolve include ${filePath}: ${err.message}`)
      return match
    }
  })
}

// Build Claude arguments - add agent settings and system prompt if specified
const fullClaudeArgs = [...claudeArgs]

// Load agent settings (hooks, permissions, etc.) from the agent's .claude/settings.json
if (agentSettingsPath && existsSync(agentSettingsPath)) {
  fullClaudeArgs.push('--settings', agentSettingsPath)
  debug(`Using agent settings: ${agentSettingsPath}`)

  // Also extract permissions and add via --allowedTools for reliability
  // (settings.json permissions can be unreliable for complex patterns)
  try {
    const settings = JSON.parse(readFileSync(agentSettingsPath, 'utf8'))
    if (settings.permissions?.allow && Array.isArray(settings.permissions.allow)) {
      // Pass each allowed tool as a separate --allowedTools argument
      // This avoids issues with quoting and spaces in patterns
      for (const tool of settings.permissions.allow) {
        fullClaudeArgs.push('--allowedTools', tool)
      }
      debug(`Added allowed tools: ${settings.permissions.allow.join(', ')}`)
    }
  } catch (err) {
    debug(`Failed to parse settings for permissions: ${err.message}`)
  }
}

// Load agent system prompt (role/persona) from the agent's CLAUDE.md
if (agentSystemPromptPath && existsSync(agentSystemPromptPath)) {
  try {
    let systemPrompt = readFileSync(agentSystemPromptPath, 'utf8')
    // Resolve any @includes in the system prompt
    systemPrompt = resolveIncludes(systemPrompt, agentSystemPromptPath)
    fullClaudeArgs.push('--append-system-prompt', systemPrompt)
    debug(`Loaded agent system prompt: ${agentSystemPromptPath} (${systemPrompt.length} chars)`)
  } catch (err) {
    debug(`Failed to read agent system prompt: ${err.message}`)
  }
}

// Set permission mode to acceptEdits for autonomous operation
// This auto-accepts file edits while still prompting for potentially dangerous operations
fullClaudeArgs.push('--permission-mode', 'acceptEdits')
debug('Using permission mode: acceptEdits')

// Create PTY
// Add tools directory to PATH so agents can use short command names (send-msg, get-roster)
const toolsPath = __dirname
const ptyProcess = pty.spawn(claudePath, fullClaudeArgs, {
  name: 'xterm-256color',
  cols,
  rows,
  cwd: agentDir,
  env: {
    ...process.env,
    PATH: `${toolsPath}:${process.env.PATH}`,
    AGENT_ID: agentId,
    INSTANCE_DIR: instanceDir,
    SESSION_ID: sessionId,
    BROKER_URL: BROKER_URL,
    TERM: 'xterm-256color'
  }
})

const tracker = new InputTracker()
let lastInjected = 0
const COOLDOWN_MS = 60000
const CHECK_INTERVAL_MS = 5000
const IDLE_TIMEOUT_MS = 2000

// Handle terminal resize (interactive mode only)
if (!headless) {
  process.stdout.on('resize', () => {
    ptyProcess.resize(process.stdout.columns, process.stdout.rows)
  })
}

// Connect to broker
const socket = io(BROKER_URL, {
  query: { agent: agentId, sessionId },
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: Infinity
})

socket.on('connect', () => {
  debug(`Socket connected, id: ${socket.id}`)
  // Send initial status and terminal size
  socket.emit('agent_ready', {
    role: agentId,
    headless,
    terminalSize: { cols, rows }
  })
})

socket.on('disconnect', (reason) => {
  debug(`Socket disconnected: ${reason}`)
})

socket.on('connect_error', (err) => {
  debug(`Socket connect error: ${err.message}`)
})

// Handle PTY output
ptyProcess.onData((data) => {
  // In interactive mode, write to local terminal
  if (!headless) {
    process.stdout.write(data)
  }

  // Always send to broker for dashboard
  if (socket.connected) {
    socket.emit('agent_output', { data })

    // Parse and emit status updates
    const statusUpdate = parseStatusFromOutput(data)
    if (statusUpdate) {
      socket.emit('agent_status', statusUpdate)
    }
  }
})

// Handle input
if (headless) {
  // Headless mode: receive input from broker/dashboard
  socket.on('agent_input', ({ data }) => {
    debug(`Received input from dashboard: ${JSON.stringify(data)}`)
    // Track input for message injection timing
    if (typeof data === 'string') {
      for (const char of data) {
        tracker.processByte(char.charCodeAt(0))
      }
    }
    ptyProcess.write(data)
    // If we were waiting for input, clear that state
    if (waitingForInput) {
      waitingForInput = false
      socket.emit('agent_status', { status: 'working', waitingForInput: false })
    }
  })
} else {
  // Interactive mode: read from local stdin
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
}

// Handle PTY exit
ptyProcess.onExit(({ exitCode, signal }) => {
  debug(`PTY exited with code ${exitCode}, signal ${signal}`)
  socket.emit('agent_status', { status: 'offline' })
  socket.disconnect()
  process.exit(exitCode)
})

// Handle team messages
socket.on('message', (message) => {
  if (message.to_agent === 'team' && message.from_agent === agentId) {
    return
  }

  if (message.message_type === 'PROJECT_INIT') {
    const content = typeof message.content === 'string'
      ? JSON.parse(message.content)
      : message.content
    writeFileSync(PROJECT_FILE, content.project_dir)
    return
  }

  debug(`Received message from ${message.from_agent}: ${message.message_type}`)
  messageQueue.push(message)
})

// Message injection
function inject(text) {
  ptyProcess.write(text)
  // Send Enter key after a short delay to ensure it's processed
  // separately from the pasted text (outside bracketed paste context)
  setTimeout(() => {
    // Send carriage return (Enter key)
    ptyProcess.write('\r')
  }, 150)
}

function formatMessageForInjection(msg) {
  let content = msg.content
  if (typeof content === 'string') {
    try {
      const parsed = JSON.parse(content)
      if (parsed.message) content = parsed.message
      else if (parsed.task) content = parsed.task
      else if (parsed.description) content = parsed.description
      else content = JSON.stringify(parsed)
    } catch {
      // Keep as-is
    }
  } else if (typeof content === 'object') {
    if (content.message) content = content.message
    else if (content.task) content = content.task
    else if (content.description) content = content.description
    else content = JSON.stringify(content)
  }
  content = String(content).replace(/\n/g, ' ').replace(/\r/g, '')
  return `[MESSAGE from ${msg.from_agent}] [${msg.message_type}]: ${content}`
}

function checkAndInject() {
  const timeSinceLastInject = Date.now() - lastInjected
  if (timeSinceLastInject < COOLDOWN_MS) return
  if (messageQueue.length === 0) return
  if (!tracker.canInject(IDLE_TIMEOUT_MS)) return

  const messages = messageQueue.splice(0, messageQueue.length)
  const messageIds = messages.map(m => m.id).filter(id => id)

  const formattedMessages = messages.map(formatMessageForInjection).join(' | ')
  const prompt = `NEW TEAM MESSAGE(S): ${formattedMessages}`

  debug(`Injecting ${messages.length} message(s)`)
  inject(prompt)
  lastInjected = Date.now()

  if (messageIds.length > 0 && socket.connected) {
    socket.emit('mark_read', { messageIds })
  }
}

setInterval(checkAndInject, CHECK_INTERVAL_MS)

// Graceful shutdown
process.on('SIGINT', () => {
  debug('Received SIGINT')
  socket.emit('agent_status', { status: 'offline' })
  socket.disconnect()
  ptyProcess.kill()
})

process.on('SIGTERM', () => {
  debug('Received SIGTERM')
  socket.emit('agent_status', { status: 'offline' })
  socket.disconnect()
  ptyProcess.kill()
})

process.on('uncaughtException', (err) => {
  debug(`Uncaught exception: ${err}`)
})

process.on('unhandledRejection', (reason) => {
  debug(`Unhandled rejection: ${reason}`)
})

// Log startup complete
if (!headless) {
  debug('Interactive mode - local terminal active')
} else {
  debug('Headless mode - waiting for dashboard connection')
  console.log(`[${agentId}] Running in headless mode. Use dashboard to interact.`)
}
