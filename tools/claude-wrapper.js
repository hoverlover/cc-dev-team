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
import { RingBuffer, InputTracker, StatusStateMachine } from './lib/index.js'
import { buildPermissionArgs } from './lib/buildPermissionArgs.js'

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
let skipPermissions = process.env.SKIP_PERMISSIONS === 'true'
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

// Track messages pending read confirmation (waiting for echo in terminal output)
const pendingReadConfirmation = []
const INJECTED_MESSAGE_MARKER = 'NEW TEAM MESSAGE'
let suppressInjectedLine = false

// Configuration via environment variables
const STATUS_IDLE_TIMEOUT_MS = parseInt(process.env.STATUS_IDLE_TIMEOUT_MS) || 8000
const STATUS_DEBOUNCE_MS = parseInt(process.env.STATUS_DEBOUNCE_MS) || 100
const STATUS_BUFFER_SIZE = parseInt(process.env.STATUS_BUFFER_SIZE) || 4096
const INPUT_DEBUG = process.env.DEBUG_INPUT_TRACKER === 'true'

// RingBuffer, InputTracker, StatusStateMachine imported from ./lib/index.js

// Custom spinner verbs for CC-Dev-Team (must match .claude/settings.json spinnerVerbs)
// Using known verbs makes state detection much more reliable
const CUSTOM_SPINNER_VERBS = [
  'Architecting', 'Engineering', 'Brewing', 'Crafting', 'Forging',
  'Assembling', 'Debugging', 'Refactoring', 'Compiling', 'Deploying',
  'Orchestrating', 'Synthesizing', 'Scheming', 'Plotting', 'Conjuring',
  'Manifesting', 'Contemplating', 'Deliberating', 'Strategizing', 'Calculating'
]

// Tightened patterns based on actual Claude Code terminal output
const STATE_PATTERNS = {
  // Thinking text patterns - match our custom spinner verbs OR generic fallback
  // Custom verbs: exact match for reliability
  // Fallback: spinner char followed by gerund + ellipsis (for non-customized sessions)
  thinkingText: new RegExp(
    `[✳✶✢✱✲✴✵✽✾✿\\*·°⊹✻][ ]{0,2}(${CUSTOM_SPINNER_VERBS.join('|')}|\\w+ing)…`
  ),

  // Tool invocation: exact tool names (may appear differently in stream)
  toolStart: /(?:Bash|Read|Edit|Write|Glob|Grep|Task|WebFetch|WebSearch|TodoWrite|NotebookEdit|AskUserQuestion|Skill)\s*\(/,

  // Permission prompts - all the ways Claude asks for user input:
  // 1. ">> accept edits on" - edit acceptance prompt (shift+Tab to cycle)
  // 2. "Do you want to proceed?" with numbered options
  // 3. Menu with "❯ 1. Yes/Allow/Approve"
  // 4. Simple "(y/n)" prompts
  // 5. "Esc to cancel" instruction line (appears in permission dialogs)
  permissionPrompt: />>.*accept|Do you want to proceed\?|❯\s*1\.\s*(Yes|Allow|Approve)|Esc to cancel.*Tab to amend|\(y\/n\)\s*$/i,

  // Completion indicators
  completion: /Brewed for|Cooked for|✓|Done in/i,

  // Idle indicators: prompt character at the very end of buffer only
  // Must be at end of string (no |⎿ since that appears mid-response)
  // The ❯ prompt must NOT be followed by numbered options (that's a permission prompt)
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
  // But skip if we recently received input (debounce to prevent re-triggering on stale content)
  const timeSinceInput = now - sm.lastInputReceivedAt
  if (STATE_PATTERNS.permissionPrompt.test(recent)) {
    if (timeSinceInput < 2000) {
      debug(`Skipping permissionPrompt match - recent input (${timeSinceInput}ms ago)`)
    } else {
      debug(`Pattern matched: permissionPrompt`)
      sm.transition('waiting_input', 'Permission required', true)
      sm.cancelIdleTimeout()
      return
    }
  }

  // Check for thinking text - matches custom spinner verbs (from settings.json) or generic fallback
  const thinkingMatch = recent.match(STATE_PATTERNS.thinkingText)
  if (thinkingMatch) {
    const verb = thinkingMatch[1]
    const thinkingText = verb + '…'
    const isCustomVerb = CUSTOM_SPINNER_VERBS.includes(verb)
    // Skip if this is stale repeated content after going idle
    if (!sm.shouldIgnoreThinkingText(thinkingText)) {
      debug(`Pattern matched: thinkingText -> "${verb}" (${isCustomVerb ? 'custom' : 'generic'})`)
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

// Set permission mode: skip all prompts if requested, otherwise acceptEdits
const permArgs = buildPermissionArgs(skipPermissions)
fullClaudeArgs.push(...permArgs)
debug(`Using permission args: ${permArgs.join(' ')}`)

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

const tracker = new InputTracker(INPUT_DEBUG ? {
  debug: (msg) => debug(`[InputTracker] ${msg}`)
} : undefined)
let lastInjected = 0
const COOLDOWN_MS = 10000
const CHECK_INTERVAL_MS = 5000
const IDLE_TIMEOUT_MS = 2000

// Initialize status tracking with state machine
const outputBuffer = new RingBuffer(STATUS_BUFFER_SIZE)
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
    stateMachine.setConfig({
      debounceMs: STATUS_DEBOUNCE_MS,
      idleTimeoutMs: STATUS_IDLE_TIMEOUT_MS
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
  markDataReceived()
  if (stateMachine) {
    stateMachine.noteOutput()
  }
  // In interactive mode, write to local terminal
  if (!headless) {
    process.stdout.write(data)
  }

  // Accumulate output in ring buffer for status detection
  const dataForBuffer = stripInjectedOutput(data)
  if (dataForBuffer) {
    outputBuffer.append(dataForBuffer)
  }

  // Check if we see our injected message echoed back - confirms delivery
  if (data.includes(INJECTED_MESSAGE_MARKER) && pendingReadConfirmation.length > 0) {
    debug('Detected message echo in output - confirming delivery')
    // Mark all pending as confirmed (they were displayed)
    for (const pending of pendingReadConfirmation) {
      if (socket.connected) {
        socket.emit('mark_read', { messageIds: pending.ids })
      }
    }
    pendingReadConfirmation.length = 0  // Clear the array
  }

  // Always send to broker for dashboard
  if (socket.connected) {
    socket.emit('agent_output', { data })

    // Detect state transitions using buffered output
    if (stateMachine && dataForBuffer) {
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
    // Also clear the buffer to prevent old permission prompt from re-triggering
    if (stateMachine && stateMachine.state === 'waiting_input') {
      debug('Input received while waiting_input - clearing buffer and transitioning to thinking')
      outputBuffer.clear()
      // Clear tracked input to avoid stale single-key responses blocking injection.
      tracker.buffer = []
      stateMachine.lastInputReceivedAt = Date.now()
      stateMachine.transition('thinking', 'Processing input...')
    }
  })

  // Headless mode: handle terminal resize from dashboard
  socket.on('terminal_resize', ({ cols, rows }) => {
    debug(`Terminal resize: ${cols}x${rows}`)
    ptyProcess.resize(cols, rows)
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
    try {
      const content = typeof message.content === 'string'
        ? JSON.parse(message.content)
        : message.content
      writeFileSync(PROJECT_FILE, content.project_dir)
    } catch (err) {
      console.warn(`[Wrapper] Ignoring PROJECT_INIT with invalid JSON:`, err.message)
    }
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

function stripInjectedOutput(data) {
  // Remove injected message line(s) from the state-detection buffer to avoid
  // false positives on tool/prompt patterns.
  if (data.includes(INJECTED_MESSAGE_MARKER)) {
    const markerIndex = data.indexOf(INJECTED_MESSAGE_MARKER)
    const before = data.slice(0, markerIndex)
    const afterMarker = data.slice(markerIndex)
    const lineEndIndex = afterMarker.search(/[\r\n]/)
    if (lineEndIndex === -1) {
      suppressInjectedLine = true
      return before
    }
    suppressInjectedLine = false
    return before + afterMarker.slice(lineEndIndex)
  }

  if (suppressInjectedLine) {
    const lineEndIndex = data.search(/[\r\n]/)
    if (lineEndIndex === -1) {
      return ''
    }
    suppressInjectedLine = false
    return data.slice(lineEndIndex)
  }

  return data
}

function checkAndInject() {
  const timeSinceLastInject = Date.now() - lastInjected
  const timeSinceLastKeystroke = Date.now() - tracker.lastKeystroke
  const state = stateMachine?.state || 'unknown'
  const timeSinceLastOutput = lastDataReceivedAt
    ? (Date.now() - lastDataReceivedAt)
    : Number.POSITIVE_INFINITY

  // Debug: log injection check status when there are pending messages
  if (messageQueue.length > 0) {
    debug(`Inject check: queue=${messageQueue.length}, cooldown=${timeSinceLastInject}ms/${COOLDOWN_MS}ms, keystroke=${timeSinceLastKeystroke}ms/${IDLE_TIMEOUT_MS}ms, inputBuf=${tracker.buffer.length}, state=${state}, outputSilent=${timeSinceLastOutput}ms`)
  }

  if (timeSinceLastInject < COOLDOWN_MS) {
    if (messageQueue.length > 0) debug(`Skipping inject - cooldown (${COOLDOWN_MS - timeSinceLastInject}ms remaining)`)
    return
  }
  if (messageQueue.length === 0) return
  if (!initialLoadComplete) {
    debug('Skipping inject - initial load not complete')
    return
  }
  if (!tracker.canInject(IDLE_TIMEOUT_MS)) {
    const bufferInfo = INPUT_DEBUG ? ` ${tracker.getBufferDebug()}` : ''
    debug(`Skipping inject - canInject=false (inputBuf=${tracker.buffer.length}, keystroke=${timeSinceLastKeystroke}ms ago)${bufferInfo}`)
    return
  }
  if (stateMachine && stateMachine.state === 'waiting_input') {
    debug('Skipping inject - agent waiting for input')
    return
  }

  // Don't inject while agent is actively streaming with extended thinking -
  // causes API error ("thinking blocks cannot be modified").
  // Safe to inject during: idle, waiting_input, working (tool execution)
  if (stateMachine && stateMachine.state === 'thinking') {
    // If we've seen no output for a while, the agent is likely idle but
    // the state machine missed the idle prompt. Allow injection to avoid
    // starving queued messages.
    if (timeSinceLastOutput < IDLE_TIMEOUT_MS) {
      debug(`Skipping inject - agent is thinking (recent output ${timeSinceLastOutput}ms ago)`)
      return
    }
    debug(`Thinking state but no output for ${timeSinceLastOutput}ms - allowing inject`)
  }

  const messages = messageQueue.splice(0, messageQueue.length)
  const messageIds = messages.map(m => m.id).filter(id => id)

  const formattedMessages = messages.map(formatMessageForInjection).join(' | ')
  const prompt = `NEW TEAM MESSAGE(S): ${formattedMessages}`

  debug(`Injecting ${messages.length} message(s)`)
  inject(prompt)
  lastInjected = Date.now()

  // Don't mark as read immediately - wait for confirmation
  // Store with timestamp so we can mark as read after delay or on output detection
  if (messageIds.length > 0) {
    pendingReadConfirmation.push({
      ids: messageIds,
      injectedAt: Date.now(),
      prompt: prompt.substring(0, 50)  // For debugging
    })
  }
}

// Mark messages as read after we see activity (agent responded to them)
// or after a timeout (to prevent infinite retries)
function checkPendingReadConfirmation() {
  if (pendingReadConfirmation.length === 0) return

  const now = Date.now()
  const CONFIRMATION_TIMEOUT_MS = 10000  // 10 seconds max wait

  // Check if agent has become active since injection (indicates message was received)
  const agentResponded = tracker.buffer.length > 0 || stateMachine?.state === 'working'

  for (let i = pendingReadConfirmation.length - 1; i >= 0; i--) {
    const pending = pendingReadConfirmation[i]
    const elapsed = now - pending.injectedAt

    // Mark as read if: agent responded OR timeout reached
    if (agentResponded || elapsed > CONFIRMATION_TIMEOUT_MS) {
      if (socket.connected) {
        debug(`Marking ${pending.ids.length} message(s) as read (${agentResponded ? 'agent responded' : 'timeout'})`)
        socket.emit('mark_read', { messageIds: pending.ids })
      }
      pendingReadConfirmation.splice(i, 1)
    }
  }
}

// Run confirmation check periodically
setInterval(checkPendingReadConfirmation, 1000)

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
