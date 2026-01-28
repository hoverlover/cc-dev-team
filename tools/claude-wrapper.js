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
let agentSystemPromptPath = process.env.AGENT_SYSTEM_PROMPT || null  // Path to agent's system-prompt.md
let agentSettingsPath = process.env.AGENT_SETTINGS || null  // Path to agent's settings.json
let pluginsDir = process.env.PLUGINS_DIR || null  // Path to orchestrator plugins directory
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

// Log warning if system prompt not provided (validated by CI, but log for debugging)
if (!agentSystemPromptPath) {
  debug('WARNING: No --agent-system-prompt provided - agent may not follow role instructions')
}

if (!instanceDir) {
  instanceDir = join(agentDir, '.claude', 'instances', agentId)
}

mkdirSync(instanceDir, { recursive: true })

const BROKER_URL = process.env.BROKER_URL || 'http://localhost:3100'
const PROJECT_FILE = join(instanceDir, 'project-dir')

// Message queue for team message injection
const messageQueue = []

// Configuration via environment variables
const STATUS_IDLE_TIMEOUT_MS = parseInt(process.env.STATUS_IDLE_TIMEOUT_MS) || 1500
const STATUS_DEBOUNCE_MS = parseInt(process.env.STATUS_DEBOUNCE_MS) || 100
const STATUS_BUFFER_SIZE = parseInt(process.env.STATUS_BUFFER_SIZE) || 4096

// Ring Buffer for accumulating PTY output
class RingBuffer {
  constructor(maxSize = STATUS_BUFFER_SIZE) {
    this.maxSize = maxSize
    this.buffer = ''
    this.lines = []
  }

  append(data) {
    // Strip ANSI escape sequences for pattern matching
    // This covers: CSI sequences, private modes, OSC sequences, and other escapes
    const cleaned = data
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')  // CSI sequences including private modes
      .replace(/\x1b\][^\x07]*\x07/g, '')       // OSC sequences (terminated by BEL)
      .replace(/\x1b\][^\x1b]*\x1b\\/g, '')     // OSC sequences (terminated by ST)
      .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '') // DCS, SOS, PM, APC sequences
      .replace(/\x1b[\x20-\x2f]*[\x30-\x7e]/g, '') // Other escape sequences
    this.buffer += cleaned
    if (this.buffer.length > this.maxSize) {
      this.buffer = this.buffer.slice(-this.maxSize)
    }
    // Track line boundaries
    this.lines = this.buffer.split(/\r?\n/)

    // Debug: log when we see bullet-like characters
    if (cleaned.includes('●') || cleaned.includes('•') || cleaned.includes('*')) {
      const snippet = cleaned.slice(0, 80).replace(/\r/g, '\\r').replace(/\n/g, '\\n')
      debug(`Bullet-like char in data: "${snippet}"`)
    }
  }

  getRecentLines(n) {
    return this.lines.slice(-n)
  }

  getLastLine() {
    return this.lines[this.lines.length - 1] || ''
  }

  endsWithPrompt() {
    return /^[❯>]\s*$/.test(this.getLastLine())
  }

  clear() {
    this.buffer = ''
    this.lines = []
  }
}

// Spinner characters for animation (matching Claude Code style)
const SPINNER_CHARS = ['✳', '✶', '✢', '✱', '✲', '✴', '✵', '✽', '✾', '✿']
const SPINNER_INTERVAL_MS = 200

// State Machine for tracking agent status
class StatusStateMachine {
  constructor(emitFn) {
    this.state = 'idle'
    this.task = ''
    this.taskBase = '' // Task text without spinner prefix
    this.waitingForInput = false
    this.stateEnteredAt = Date.now()
    this.lastEmitAt = 0
    this.lastEmittedState = null
    this.emit = emitFn
    this.idleTimer = null
    this.spinnerTimer = null
    this.spinnerIndex = 0
    // Track last thinking text to prevent re-triggering on stale content
    this.lastThinkingText = ''
    this.lastThinkingSeenAt = 0
    this.idleTransitionAt = 0  // When we last went idle
  }

  // Valid state transitions
  // Note: Claude can jump between states quickly, so we allow flexible transitions
  static VALID_TRANSITIONS = {
    idle: ['thinking', 'working', 'waiting_input'],  // Can start with any activity
    thinking: ['working', 'waiting_input', 'idle'],
    working: ['thinking', 'waiting_input', 'idle'],  // Tool can trigger input prompt
    waiting_input: ['thinking', 'working', 'idle'],  // Input can lead to any state
    offline: ['idle', 'thinking', 'working']  // Can recover from offline
  }

  transition(newState, task = '', waitingForInput = false) {
    // Always allow transition to offline
    if (newState === 'offline') {
      this.stopSpinner()
      this.state = 'offline'
      this.task = ''
      this.taskBase = ''
      this.waitingForInput = false
      this.stateEnteredAt = Date.now()
      this.emitIfChanged()
      return true
    }

    // Allow self-transitions (updating task while in same state)
    if (newState === this.state) {
      // Only update if task base changed
      if (task !== this.taskBase) {
        if (newState === 'thinking' || newState === 'working') {
          this.startSpinner(task)
        } else {
          // Stop spinner when in non-spinner state (idle, waiting_input)
          this.stopSpinner()
          this.task = task
          this.taskBase = task
          this.emitIfChanged()
        }
      }
      return true
    }

    // Validate transition is legal
    const validTargets = StatusStateMachine.VALID_TRANSITIONS[this.state]
    if (!validTargets?.includes(newState)) {
      debug(`Invalid transition: ${this.state} → ${newState}`)
      return false
    }

    debug(`State transition: ${this.state} → ${newState} (task: ${task || 'none'})`)
    this.state = newState
    this.waitingForInput = waitingForInput
    this.stateEnteredAt = Date.now()

    // Start/stop spinner based on state
    if (newState === 'thinking' || newState === 'working') {
      this.lastThinkingText = task
      this.lastThinkingSeenAt = Date.now()
      this.startSpinner(task)
    } else {
      // Track when we go idle
      if (newState === 'idle') {
        this.idleTransitionAt = Date.now()
      }
      this.stopSpinner()
      this.task = task
      this.taskBase = task
      this.emitIfChanged()
    }

    return true
  }

  // Check if thinking text should be ignored (stale repeated content)
  shouldIgnoreThinkingText(text) {
    const now = Date.now()
    const timeSinceIdle = now - this.idleTransitionAt
    const isSameText = text === this.lastThinkingText

    // If we went idle recently (within 5 seconds) and see the same thinking text,
    // it's probably stale terminal content being re-rendered
    if (this.state === 'idle' && isSameText && timeSinceIdle < 5000) {
      debug(`Ignoring stale thinking text "${text}" (${timeSinceIdle}ms since idle)`)
      return true
    }
    return false
  }

  emitIfChanged() {
    const now = Date.now()

    // Build status object
    const statusObj = {
      status: this.state,
      task: this.task,
      waitingForInput: this.waitingForInput
    }

    // Only emit if something actually changed
    const stateKey = `${this.state}:${this.task}:${this.waitingForInput}`
    if (stateKey === this.lastEmittedState) {
      return
    }

    // Check if this is a STATE change (not just task/spinner update)
    const lastState = this.lastEmittedState?.split(':')[0]
    const isStateChange = lastState !== this.state

    // Debounce spinner updates (same state, different task), but ALWAYS emit state changes
    if (!isStateChange && now - this.lastEmitAt < STATUS_DEBOUNCE_MS) {
      return
    }

    this.lastEmitAt = now
    this.lastEmittedState = stateKey
    this.emit(statusObj)
  }

  scheduleIdleTimeout(buffer) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
    }

    this.idleTimer = setTimeout(() => {
      // If we're in thinking or working state for too long without updates,
      // transition to idle (completion may have been missed)
      if (this.state === 'thinking' || this.state === 'working') {
        debug(`Idle timeout: transitioning from ${this.state} to idle`)
        this.transition('idle')
        // Clear buffer to prevent old thinking text from retriggering
        if (buffer) buffer.clear()
      }
    }, STATUS_IDLE_TIMEOUT_MS)
  }

  cancelIdleTimeout() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  startSpinner(taskBase) {
    this.taskBase = taskBase
    this.spinnerIndex = 0
    this.updateSpinnerTask()

    // Clear any existing spinner timer
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer)
    }

    // Start spinner animation
    this.spinnerTimer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_CHARS.length
      this.updateSpinnerTask()
    }, SPINNER_INTERVAL_MS)
  }

  updateSpinnerTask() {
    const spinner = SPINNER_CHARS[this.spinnerIndex]
    this.task = `${spinner} ${this.taskBase}`
    this.emitIfChanged()
  }

  stopSpinner() {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer)
      this.spinnerTimer = null
    }
  }
}

// Tightened patterns based on actual Claude Code terminal output
const STATE_PATTERNS = {
  // Thinking text patterns - spinner char followed by gerund + ellipsis
  // Claude shows: "✳ Fermenting…" or "✶ Cogitating…" etc.
  // IMPORTANT: Only allow actual space chars (not \r\n) to prevent matching
  // across fragmented terminal refreshes where spinner and text are on different lines
  thinkingText: /[✳✶✢✱✲✴✵✽✾✿\*·°⊹✻][ ]{0,2}(\w+ing)…/,

  // Tool invocation: exact tool names (may appear differently in stream)
  toolStart: /(?:Bash|Read|Edit|Write|Glob|Grep|Task|WebFetch|WebSearch|TodoWrite|NotebookEdit|AskUserQuestion|Skill)\s*\(/,

  // Permission prompt: actual permission dialogs (NOT the status bar "accept edits on")
  // Look for: numbered menu options, (y/n) prompts, "Allow" buttons
  permissionPrompt: /❯\s*1\.\s*(Yes|Allow|Approve)|Do you want to proceed\?|\(y\/n\)\s*$/i,

  // Completion indicators
  completion: /Brewed for|Cooked for|✓|Done in/i,

  // Idle indicators: prompt character at the very end of buffer only
  // Must be at end of string (no |⎿ since that appears mid-response)
  idlePrompt: /[❯>]\s*$/
}

// Track when we last received PTY data for freshness checks
let lastDataReceivedAt = 0

// Detect state transitions from buffered output
function detectStateTransition(buffer, sm) {
  const text = buffer.buffer
  const now = Date.now()

  // Debug: log buffer content periodically (every 2 seconds max)
  if (!detectStateTransition.lastDebug || now - detectStateTransition.lastDebug > 2000) {
    detectStateTransition.lastDebug = now
    // Log more of the buffer to see actual content
    const sample = text.slice(-500).replace(/[\x00-\x1f]/g, c => `[${c.charCodeAt(0)}]`)
    debug(`Buffer (${text.length} chars): "${sample.slice(0, 200)}"`)
  }

  // Check recent portion of buffer for activity patterns
  const recent = text.slice(-500)
  // Check very end of buffer for idle prompt (must be at the actual end)
  const bufferEnd = text.slice(-30)

  // Wait for initial load to complete before detecting active states
  // The initial terminal UI render contains spinner-like chars but isn't actual processing
  if (!initialLoadComplete) {
    // Only check for idle prompt during initial load
    if (STATE_PATTERNS.idlePrompt.test(bufferEnd)) {
      debug(`Initial load complete - first idle prompt detected`)
      initialLoadComplete = true
      buffer.clear()
      sm.transition('idle')
      sm.cancelIdleTimeout()
    }
    return
  }

  // Check for permission prompt (highest priority - needs user input)
  if (STATE_PATTERNS.permissionPrompt.test(recent)) {
    debug(`Pattern matched: permissionPrompt`)
    sm.transition('waiting_input', 'Permission required', true)
    sm.cancelIdleTimeout()
    return
  }

  // Check for thinking text like "✳ Fermenting…" - this is the primary indicator
  const thinkingMatch = recent.match(STATE_PATTERNS.thinkingText)
  if (thinkingMatch) {
    const thinkingText = thinkingMatch[1] + '…'
    // Skip if this is stale repeated content after going idle
    if (!sm.shouldIgnoreThinkingText(thinkingText)) {
      debug(`Pattern matched: thinkingText -> ${thinkingMatch[0]}`)
      sm.transition('thinking', thinkingText)
      sm.scheduleIdleTimeout(buffer)
    }
    return
  }

  // Check for tool invocation
  const toolMatch = recent.match(STATE_PATTERNS.toolStart)
  if (toolMatch) {
    debug(`Pattern matched: toolStart -> ${toolMatch[0]}`)
    sm.transition('working', toolMatch[0])
    sm.scheduleIdleTimeout(buffer)
    return
  }

  // Check for completion
  if (STATE_PATTERNS.completion.test(recent)) {
    debug(`Pattern matched: completion`)
    sm.scheduleIdleTimeout(buffer)
    return
  }

  // Check for idle prompt - ONLY at the very end of buffer
  // Also require minimum time in active state to prevent flapping
  const minActiveTime = 500  // ms
  const timeInState = now - sm.stateEnteredAt
  const isActive = sm.state === 'thinking' || sm.state === 'working'

  if (STATE_PATTERNS.idlePrompt.test(bufferEnd)) {
    if (!isActive || timeInState >= minActiveTime) {
      debug(`Pattern matched: idlePrompt (end of buffer)`)
      sm.transition('idle')
      sm.cancelIdleTimeout()
      // Clear buffer on idle to prevent old content from triggering false positives
      buffer.clear()
    }
    return
  }
}

// Mark data as received (called from PTY onData handler)
function markDataReceived() {
  lastDataReceivedAt = Date.now()
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

// Resolve @/path/to/file includes in system-prompt.md content
function resolveIncludes(content, basePath) {
  // Match @path patterns (absolute or relative)
  const includePattern = /^@([^\s\n]+)$/gm
  return content.replace(includePattern, (match, filePath) => {
    try {
      // Resolve path relative to the file containing the include
      let resolvedPath = filePath
      if (!filePath.startsWith('/')) {
        resolvedPath = join(dirname(basePath), filePath)
      }

      if (existsSync(resolvedPath)) {
        const includedContent = readFileSync(resolvedPath, 'utf8')
        debug(`Resolved include: ${filePath} -> ${resolvedPath} (${includedContent.length} chars)`)
        // Recursively resolve includes in the included content
        return resolveIncludes(includedContent, resolvedPath)
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

// Load agent system prompt (role/persona) from the agent's system-prompt.md
if (agentSystemPromptPath && existsSync(agentSystemPromptPath)) {
  try {
    let systemPrompt = readFileSync(agentSystemPromptPath, 'utf8')
    // Resolve any @includes in the system prompt
    systemPrompt = resolveIncludes(systemPrompt, agentSystemPromptPath)
    fullClaudeArgs.push('--append-system-prompt', systemPrompt)
    debug(`Loaded agent system prompt: ${agentSystemPromptPath} (${systemPrompt.length} chars after includes)`)
  } catch (err) {
    debug(`Failed to read agent system prompt: ${err.message}`)
  }
}

// Check for agent-specific plugins
if (pluginsDir) {
  // Derive base role (e.g., "engineer" from "engineer-1")
  const baseRole = agentId.replace(/-\d+$/, '')
  const agentPluginDir = join(pluginsDir, baseRole)

  if (existsSync(join(agentPluginDir, '.claude-plugin', 'plugin.json'))) {
    fullClaudeArgs.push('--plugin-dir', agentPluginDir)
    debug(`Using plugin directory: ${agentPluginDir}`)
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
const COOLDOWN_MS = 10000
const CHECK_INTERVAL_MS = 5000
const IDLE_TIMEOUT_MS = 2000

// Initialize status tracking with state machine
const outputBuffer = new RingBuffer()
let stateMachine = null // Initialized after socket connection
let initialLoadComplete = false // Don't detect status until first idle prompt seen

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

  // Initialize state machine with socket emit function
  if (!stateMachine) {
    stateMachine = new StatusStateMachine((status) => {
      if (socket.connected) {
        debug(`Emitting status: ${JSON.stringify(status)}`)
        socket.emit('agent_status', status)
      }
    })
    // Emit initializing status on startup - start spinner animation
    stateMachine.startSpinner('Initializing...')

    // Set a timeout to complete initialization if idle prompt isn't detected
    // This handles the case where Claude Code is already idle when we connect
    setTimeout(() => {
      if (!initialLoadComplete) {
        debug('Initialization timeout - assuming idle')
        initialLoadComplete = true
        outputBuffer.clear()
        stateMachine.transition('idle')
      }
    }, 3000)  // 3 second timeout
  }

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

  // Accumulate output in ring buffer for status detection
  outputBuffer.append(data)

  // Always send to broker for dashboard
  if (socket.connected) {
    socket.emit('agent_output', { data })

    // Detect state transitions using buffered output
    if (stateMachine) {
      detectStateTransition(outputBuffer, stateMachine)
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
    // If we were waiting for input, transition to thinking (input received)
    if (stateMachine && stateMachine.state === 'waiting_input') {
      stateMachine.transition('thinking', 'Processing input...')
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
  if (stateMachine) {
    stateMachine.transition('offline')
  } else {
    socket.emit('agent_status', { status: 'offline' })
  }
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

// Handle session rename requests
socket.on('rename_session', ({ issueNum, worktreeName }) => {
  const sessionName = `${agentId}-${issueNum}-${worktreeName}`
  debug(`Renaming session to: ${sessionName}`)
  // Inject the rename command directly (bypasses message queue)
  ptyProcess.write(`/rename ${sessionName}`)
  setTimeout(() => {
    ptyProcess.write('\r')
  }, 150)
})

// Handle workspace sync requests (worktree changes)
socket.on('workspace_sync', ({ path, action }) => {
  debug(`Workspace sync: action=${action}, path=${path}`)
  // Inject cd command to change directory
  if (action === 'switch' && path) {
    ptyProcess.write(`cd "${path}"`)
    setTimeout(() => {
      ptyProcess.write('\r')
    }, 150)
  } else if (action === 'remove' && path) {
    // Switch back to the specified path (usually original project dir)
    ptyProcess.write(`cd "${path}"`)
    setTimeout(() => {
      ptyProcess.write('\r')
    }, 150)
  }
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

  // If content is an object, stringify it (backwards compatibility)
  if (typeof content === 'object' && content !== null) {
    content = JSON.stringify(content)
  }

  // Clean up for single-line injection
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
  if (stateMachine) {
    stateMachine.cancelIdleTimeout()
    stateMachine.transition('offline')
  } else {
    socket.emit('agent_status', { status: 'offline' })
  }
  socket.disconnect()
  ptyProcess.kill()
})

process.on('SIGTERM', () => {
  debug('Received SIGTERM')
  if (stateMachine) {
    stateMachine.cancelIdleTimeout()
    stateMachine.transition('offline')
  } else {
    socket.emit('agent_status', { status: 'offline' })
  }
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
