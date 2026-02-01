import { Server } from 'socket.io'
import { createServer } from 'http'
import Database from 'better-sqlite3'
import { mkdirSync, readdirSync, statSync, existsSync, writeFileSync } from 'fs'
import { dirname, join, basename, resolve } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import { homedir } from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ORCHESTRATOR_DIR = join(__dirname, '..')
const DATA_DIR = join(ORCHESTRATOR_DIR, 'data')
const TOOLS_DIR = join(ORCHESTRATOR_DIR, 'tools')
const AGENTS_DIR = join(ORCHESTRATOR_DIR, 'agents')
const PLUGINS_DIR = join(ORCHESTRATOR_DIR, 'plugins')
const UPLOADS_DIR = join(homedir(), '.cc-dev-team', 'uploads')

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(UPLOADS_DIR, { recursive: true })

// Initialize SQLite database for message persistence
const db = new Database(join(DATA_DIR, 'messages.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    session_id TEXT,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    thread_id TEXT,
    message_type TEXT NOT NULL,
    content TEXT NOT NULL,
    read INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent);
  CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
`)

const server = createServer()
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

// Sessions: sessionId -> Session
const sessions = new Map()

// Session structure
function createSession(projectDir, name = null) {
  const id = randomUUID()
  const session = {
    id,
    name: name || basename(projectDir),
    projectDir: resolve(projectDir),
    createdAt: new Date().toISOString(),
    agents: new Map(),           // role -> agent info
    outputBuffers: new Map(),    // role -> terminal output string
    processes: new Map(),        // role -> ChildProcess
    project: { project_dir: resolve(projectDir) }
  }
  sessions.set(id, session)
  console.log(`[Broker] Created session ${id} for project: ${projectDir}`)
  return session
}

function getSession(sessionId) {
  return sessions.get(sessionId)
}

function deleteSession(sessionId) {
  const session = sessions.get(sessionId)
  if (session) {
    // Kill all agent processes
    for (const [role, proc] of session.processes) {
      console.log(`[Broker] Killing agent ${role} in session ${sessionId}`)
      proc.kill('SIGTERM')
    }
    sessions.delete(sessionId)
    console.log(`[Broker] Deleted session ${sessionId}`)
  }
}

// No default session - agents must be spawned by the broker with a valid session ID

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_OUTPUT_BUFFER = 500000 // 500KB per agent
const AVAILABLE_AGENTS = ['pm', 'architect', 'engineer', 'qa-engineer', 'ui-ux', 'code-auditor', 'docs-auditor']

// ============================================================================
// DIRECTORY BROWSING
// ============================================================================

function listDirectory(dirPath) {
  try {
    const resolvedPath = dirPath.startsWith('~')
      ? join(homedir(), dirPath.slice(1))
      : resolve(dirPath)

    if (!existsSync(resolvedPath)) {
      return { error: 'Directory not found', path: resolvedPath }
    }

    const stat = statSync(resolvedPath)
    if (!stat.isDirectory()) {
      return { error: 'Not a directory', path: resolvedPath }
    }

    const entries = readdirSync(resolvedPath, { withFileTypes: true })
    const items = entries
      .filter(entry => !entry.name.startsWith('.')) // Hide hidden files
      .map(entry => ({
        name: entry.name,
        path: join(resolvedPath, entry.name),
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile()
      }))
      .sort((a, b) => {
        // Directories first, then alphabetically
        if (a.isDirectory && !b.isDirectory) return -1
        if (!a.isDirectory && b.isDirectory) return 1
        return a.name.localeCompare(b.name)
      })

    return {
      path: resolvedPath,
      parent: dirname(resolvedPath),
      items
    }
  } catch (err) {
    return { error: err.message, path: dirPath }
  }
}

// ============================================================================
// AGENT SPAWNING
// ============================================================================

function spawnAgent(session, role) {
  if (session.processes.has(role)) {
    console.log(`[Broker] Agent ${role} already running in session ${session.id}`)
    return { success: false, error: 'Agent already running' }
  }

  const wrapperPath = join(TOOLS_DIR, 'claude-wrapper.js')

  // Determine the agent's config directory (where system-prompt.md and .claude/settings.json live)
  let agentConfigDir = join(AGENTS_DIR, role)
  if (!existsSync(agentConfigDir)) {
    // Engineer instances (engineer-1, engineer-2, etc.) use the generic engineer directory
    if (role.startsWith('engineer-')) {
      agentConfigDir = join(AGENTS_DIR, 'engineer')
    } else {
      agentConfigDir = null
    }
  }

  // Build paths for agent config files
  const agentSystemPrompt = agentConfigDir ? join(agentConfigDir, 'system-prompt.md') : null
  const agentSettings = agentConfigDir ? join(agentConfigDir, '.claude', 'settings.json') : null

  console.log(`[Broker] Spawning ${role} in ${session.projectDir} for session ${session.id}`)
  if (agentSystemPrompt && existsSync(agentSystemPrompt)) {
    console.log(`[Broker] Agent system prompt: ${agentSystemPrompt}`)
  }
  if (agentSettings && existsSync(agentSettings)) {
    console.log(`[Broker] Agent settings: ${agentSettings}`)
  }

  const proc = spawn('node', [wrapperPath], {
    cwd: session.projectDir,
    env: {
      ...process.env,
      AGENT_ROLE: role,
      BROKER_URL: `http://localhost:${PORT}`,
      SESSION_ID: session.id,
      PROJECT_DIR: session.projectDir,
      ORCHESTRATOR_DIR: ORCHESTRATOR_DIR,
      PLUGINS_DIR: PLUGINS_DIR,
      AGENT_SYSTEM_PROMPT: agentSystemPrompt && existsSync(agentSystemPrompt) ? agentSystemPrompt : '',
      AGENT_SETTINGS: agentSettings && existsSync(agentSettings) ? agentSettings : '',
      HEADLESS: 'true'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })

  session.processes.set(role, proc)

  proc.stdout.on('data', (data) => {
    console.log(`[${role}:stdout] ${data.toString().trim()}`)
  })

  proc.stderr.on('data', (data) => {
    console.error(`[${role}:stderr] ${data.toString().trim()}`)
  })

  proc.on('exit', (code, signal) => {
    console.log(`[Broker] Agent ${role} exited with code ${code}, signal ${signal}`)
    session.processes.delete(role)

    // Notify dashboard that agent left
    const agent = session.agents.get(role)
    if (agent) {
      session.agents.delete(role)
      session.outputBuffers.delete(role)
      io.to(`session:${session.id}:dashboard`).emit('agent_left', {
        sessionId: session.id,
        role,
        timestamp: new Date().toISOString()
      })
    }
  })

  return { success: true, role, sessionId: session.id }
}

function stopAgent(session, role) {
  const proc = session.processes.get(role)
  if (proc) {
    proc.kill('SIGTERM')
    return { success: true }
  }
  return { success: false, error: 'Agent not running' }
}

function forceKillAgent(session, role) {
  const proc = session.processes.get(role)
  if (proc) {
    console.log(`[Broker] Force killing agent ${role} in session ${session.id}`)
    proc.kill('SIGKILL')
    // Clean up immediately since SIGKILL doesn't allow graceful cleanup
    session.processes.delete(role)
    session.agents.delete(role)
    session.outputBuffers.delete(role)
    io.to(`session:${session.id}:dashboard`).emit('agent_left', {
      sessionId: session.id,
      role,
      timestamp: new Date().toISOString()
    })
    return { success: true }
  }
  return { success: false, error: 'Agent not running' }
}

// ============================================================================
// SOCKET.IO CONNECTION HANDLING
// ============================================================================

io.on('connection', (socket) => {
  const agentRole = socket.handshake.query.agent
  const isDashboard = socket.handshake.query.dashboard === 'true'
  const sessionId = socket.handshake.query.sessionId || 'default'

  // -------------------------------------------------------------------------
  // DASHBOARD CONNECTION
  // -------------------------------------------------------------------------
  if (isDashboard) {
    console.log(`[Broker] Dashboard connected`)
    socket.join('dashboards') // Global dashboard room

    // Send list of all sessions
    const sessionList = Array.from(sessions.values()).map(s => ({
      id: s.id,
      name: s.name,
      projectDir: s.projectDir,
      agentCount: s.agents.size,
      createdAt: s.createdAt
    }))
    socket.emit('sessions', sessionList)

    // ---- Session Management ----

    socket.on('create_session', ({ projectDir, name, agents = ['pm'] }, callback) => {
      try {
        const session = createSession(projectDir, name)

        // Notify all dashboards of new session
        io.to('dashboards').emit('session_created', {
          id: session.id,
          name: session.name,
          projectDir: session.projectDir,
          agentCount: 0,
          createdAt: session.createdAt
        })

        // Send callback first so dashboard can join the session room
        callback({ success: true, session: { id: session.id, name: session.name }, agentsToSpawn: agents })

        // Spawn agents AFTER callback, giving dashboard time to join session room
        // This ensures dashboard receives agent_joined events
        setTimeout(() => {
          for (const role of agents) {
            spawnAgent(session, role)
          }
        }, 100)
      } catch (err) {
        callback({ success: false, error: err.message })
      }
    })

    socket.on('delete_session', ({ sessionId }, callback) => {
      if (sessionId === 'default') {
        callback({ success: false, error: 'Cannot delete default session' })
        return
      }
      deleteSession(sessionId)
      io.to('dashboards').emit('session_deleted', { sessionId })
      callback({ success: true })
    })

    socket.on('get_sessions', (callback) => {
      const sessionList = Array.from(sessions.values()).map(s => ({
        id: s.id,
        name: s.name,
        projectDir: s.projectDir,
        agentCount: s.agents.size,
        createdAt: s.createdAt
      }))
      callback(sessionList)
    })

    // ---- Join/Leave Session (for tab switching) ----

    socket.on('join_session', ({ sessionId }, callback) => {
      const session = getSession(sessionId)
      if (!session) {
        callback({ success: false, error: 'Session not found' })
        return
      }

      socket.join(`session:${sessionId}:dashboard`)

      // Send session state
      callback({
        success: true,
        session: {
          id: session.id,
          name: session.name,
          projectDir: session.projectDir,
          issueNum: session.issueNum,
          worktreeName: session.worktreeName,
          issueTitle: session.issueTitle,
          issueUrl: session.issueUrl,
          taskSummary: session.taskSummary
        },
        roster: Array.from(session.agents.keys()),
        project: session.project
      })

      // Send recent messages for this session
      const recentMessages = db.prepare(`
        SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 50
      `).all(sessionId).reverse()
      socket.emit('message_history', { sessionId, messages: recentMessages })
    })

    socket.on('leave_session', ({ sessionId }) => {
      socket.leave(`session:${sessionId}:dashboard`)
    })

    // ---- Directory Browsing ----

    socket.on('list_directory', ({ path }, callback) => {
      const result = listDirectory(path || homedir())
      callback(result)
    })

    // ---- Agent Management ----

    socket.on('spawn_agent', ({ sessionId, role }, callback) => {
      const session = getSession(sessionId)
      if (!session) {
        callback({ success: false, error: 'Session not found' })
        return
      }
      const result = spawnAgent(session, role)
      callback(result)
    })

    socket.on('stop_agent', ({ sessionId, role }, callback) => {
      const session = getSession(sessionId)
      if (!session) {
        callback({ success: false, error: 'Session not found' })
        return
      }
      const result = stopAgent(session, role)
      callback(result)
    })

    socket.on('force_kill_agent', ({ sessionId, role }, callback) => {
      const session = getSession(sessionId)
      if (!session) {
        callback({ success: false, error: 'Session not found' })
        return
      }
      const result = forceKillAgent(session, role)
      callback(result)
    })

    socket.on('get_available_agents', (callback) => {
      callback(AVAILABLE_AGENTS)
    })

    // ---- Terminal Output Subscription ----

    socket.on('subscribe_output', ({ sessionId, agent }) => {
      const session = getSession(sessionId)
      if (!session) return

      const subKey = `${sessionId}:${agent}`
      if (!socket.data.outputSubs) socket.data.outputSubs = new Set()

      const isNewSubscription = !socket.data.outputSubs.has(subKey)
      socket.data.outputSubs.add(subKey)

      if (isNewSubscription) {
        // Send historical output buffer
        const historicalOutput = session.outputBuffers.get(agent)
        const bufferSize = historicalOutput ? historicalOutput.length : 0
        console.log(`[Broker] Dashboard subscribed to ${agent} output in session ${sessionId} (historical buffer: ${bufferSize} bytes)`)
        if (historicalOutput) {
          socket.emit('agent_output', { sessionId, agent, data: historicalOutput })
        }
      }
    })

    socket.on('unsubscribe_output', ({ sessionId, agent }) => {
      if (socket.data.outputSubs) {
        socket.data.outputSubs.delete(`${sessionId}:${agent}`)
      }
    })

    // ---- Agent Input (for headless terminal) ----

    socket.on('agent_input', ({ sessionId, agent, data }) => {
      const session = getSession(sessionId)
      if (!session) return

      const agentInfo = session.agents.get(agent)
      if (agentInfo && agentInfo.socketId) {
        io.to(agentInfo.socketId).emit('agent_input', { data })
      }
    })

    // ---- File Upload ----

    socket.on('upload_file', ({ sessionId, filename, data, mimeType }, callback) => {
      try {
        // Create session-specific upload directory
        const sessionUploadDir = join(UPLOADS_DIR, sessionId)
        mkdirSync(sessionUploadDir, { recursive: true })

        // Generate unique filename to avoid collisions
        const timestamp = Date.now()
        const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
        const uniqueFilename = `${timestamp}-${safeFilename}`
        const filePath = join(sessionUploadDir, uniqueFilename)

        // Decode base64 data and write to file
        const buffer = Buffer.from(data, 'base64')
        writeFileSync(filePath, buffer)

        console.log(`[Broker] File uploaded: ${filePath} (${buffer.length} bytes)`)

        callback({ success: true, path: filePath })
      } catch (err) {
        console.error(`[Broker] File upload error:`, err)
        callback({ success: false, error: err.message })
      }
    })

    // ---- Agent Info Request ----

    socket.on('get_agent_info', ({ sessionId, agent }, callback) => {
      const session = getSession(sessionId)
      if (!session) {
        callback(null)
        return
      }

      const agentInfo = session.agents.get(agent)
      if (agentInfo) {
        callback({
          role: agent,
          sessionId,
          headless: agentInfo.headless,
          terminalSize: agentInfo.terminalSize,
          status: agentInfo.status,
          task: agentInfo.task,
          waitingForInput: agentInfo.waitingForInput
        })
      } else {
        callback(null)
      }
    })

    socket.on('disconnect', () => {
      console.log('[Broker] Dashboard disconnected')
    })

    return
  }

  // -------------------------------------------------------------------------
  // AGENT CONNECTION
  // -------------------------------------------------------------------------

  const isTransient = socket.handshake.query.transient === 'true'

  // Get session - agents must have a valid session ID
  const session = getSession(sessionId)
  if (!session) {
    console.log(`[Broker] Rejecting ${agentRole} - invalid session ID: ${sessionId}`)
    socket.emit('error', { message: 'Invalid session ID' })
    socket.disconnect(true)
    return
  }

  if (isTransient) {
    console.log(`[Broker] ${agentRole} transient connection (send-message) in session ${session.id}`)
  } else {
    console.log(`[Broker] ${agentRole} connected to session ${session.id}`)

    // Register agent in session
    session.agents.set(agentRole, {
      role: agentRole,
      sessionId: session.id,
      connectedAt: new Date().toISOString(),
      socketId: socket.id,
      status: 'idle'
    })

    // Join session-specific rooms
    socket.join(`session:${session.id}:agent:${agentRole}`)
    socket.join(`session:${session.id}:team`)

    // Numbered agents (engineer-1, engineer-2, etc.) also join the base role room
    // so messages to "engineer" reach all engineer instances
    const baseRoleMatch = agentRole.match(/^(.+)-\d+$/)
    if (baseRoleMatch) {
      const baseRole = baseRoleMatch[1]
      socket.join(`session:${session.id}:agent:${baseRole}`)
      console.log(`[Broker] ${agentRole} also joined room: agent:${baseRole}`)
    }

    // Notify dashboards in this session that agent joined
    io.to(`session:${session.id}:dashboard`).emit('agent_joined', {
      sessionId: session.id,
      role: agentRole,
      timestamp: new Date().toISOString()
    })
  }

  // Send project context to newly joined agent
  if (session.project) {
    socket.emit('message', {
      id: Date.now(),
      created_at: new Date().toISOString(),
      session_id: session.id,
      from_agent: 'system',
      to_agent: agentRole,
      message_type: 'PROJECT_INIT',
      content: session.project
    })
  }

  // Send unread messages for this session
  if (!isTransient) {
    // For numbered agents (engineer-1), also get messages sent to base role (engineer)
    const baseRoleMatch = agentRole.match(/^(.+)-\d+$/)
    const baseRole = baseRoleMatch ? baseRoleMatch[1] : null

    let unreadMessages
    if (baseRole) {
      unreadMessages = db.prepare(`
        SELECT * FROM messages
        WHERE session_id = ? AND (to_agent = ? OR to_agent = ? OR to_agent = 'team') AND read = 0
        ORDER BY created_at ASC
      `).all(session.id, agentRole, baseRole)
    } else {
      unreadMessages = db.prepare(`
        SELECT * FROM messages
        WHERE session_id = ? AND (to_agent = ? OR to_agent = 'team') AND read = 0
        ORDER BY created_at ASC
      `).all(session.id, agentRole)
    }

    if (unreadMessages.length > 0) {
      console.log(`[Broker] Sending ${unreadMessages.length} unread messages to ${agentRole}`)
      for (const msg of unreadMessages) {
        socket.emit('message', msg)
      }
    }
  }

  console.log(`[Broker] Session ${session.id} agents: ${[...session.agents.keys()].join(', ')}`)

  // ---- Message Handling ----

  socket.on('send_message', (msg, callback) => {
    const { to, threadId, type, content } = msg

    const message = {
      created_at: new Date().toISOString(),
      session_id: session.id,
      from_agent: agentRole,
      to_agent: to,
      thread_id: threadId || null,
      message_type: type,
      content: typeof content === 'string' ? content : JSON.stringify(content)
    }

    // Persist to database and get the actual row ID
    try {
      const result = db.prepare(`
        INSERT INTO messages (session_id, from_agent, to_agent, thread_id, message_type, content)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(message.session_id, message.from_agent, message.to_agent, message.thread_id, message.message_type, message.content)
      // Use the actual database ID so mark_read works correctly
      message.id = result.lastInsertRowid
    } catch (err) {
      console.error('[Broker] Failed to persist message:', err)
      // Fallback to timestamp if insert fails (message won't be markable as read)
      message.id = Date.now()
    }

    // Handle PROJECT_INIT specially
    if (type === 'PROJECT_INIT') {
      session.project = typeof content === 'string' ? JSON.parse(content) : content
      io.to(`session:${session.id}:dashboard`).emit('project', { sessionId: session.id, project: session.project })
    }

    // Route message within session
    if (to === 'team') {
      const teamRoom = `session:${session.id}:team`
      const teamSize = io.sockets.adapter.rooms.get(teamRoom)?.size || 0
      socket.to(teamRoom).emit('message', message)
      console.log(`[Broker] [${session.id}] ${agentRole} → team: ${type} (${teamSize} recipients in room)`)
    } else {
      const agentRoom = `session:${session.id}:agent:${to}`
      const roomSize = io.sockets.adapter.rooms.get(agentRoom)?.size || 0
      io.to(agentRoom).emit('message', message)
      console.log(`[Broker] [${session.id}] ${agentRole} → ${to}: ${type} (${roomSize} in room ${agentRoom})`)
    }

    // Send to dashboards watching this session
    io.to(`session:${session.id}:dashboard`).emit('message', message)

    if (callback) callback({ success: true, messageId: message.id })
  })

  // ---- Spawn Agent (allows PM or other agents to spawn new agents) ----

  socket.on('spawn_agent', ({ role }, callback) => {
    console.log(`[Broker] ${agentRole} requested spawn of ${role} in session ${session.id}`)
    const result = spawnAgent(session, role)
    if (callback) callback(result)
  })

  // ---- Agent Ready (headless info) ----

  socket.on('agent_ready', ({ role, headless, terminalSize }) => {
    const agent = session.agents.get(role)
    if (agent) {
      agent.headless = headless
      agent.terminalSize = terminalSize
      console.log(`[Broker] ${role} ready in session ${session.id} - headless: ${headless}`)
      io.to(`session:${session.id}:dashboard`).emit('agent_info', {
        sessionId: session.id,
        role,
        headless,
        terminalSize
      })
    }
  })

  // ---- Status Updates ----

  socket.on('agent_status', ({ status, task, waitingForInput }) => {
    const agent = session.agents.get(agentRole)
    if (agent) {
      agent.status = status
      if (task !== undefined) agent.task = task
      if (waitingForInput !== undefined) agent.waitingForInput = waitingForInput
      io.to(`session:${session.id}:dashboard`).emit('agent_status', {
        sessionId: session.id,
        role: agentRole,
        status,
        task: agent.task,
        waitingForInput: agent.waitingForInput
      })
    }
  })

  // Legacy status_update handler
  socket.on('status_update', (status) => {
    const agent = session.agents.get(agentRole)
    if (agent) {
      agent.status = status
      io.to(`session:${session.id}:dashboard`).emit('agent_status', {
        sessionId: session.id,
        role: agentRole,
        status
      })
    }
  })

  // ---- Mark Messages Read ----

  socket.on('mark_read', ({ messageIds }) => {
    if (messageIds && messageIds.length > 0) {
      const placeholders = messageIds.map(() => '?').join(',')
      db.prepare(`UPDATE messages SET read = 1 WHERE id IN (${placeholders})`).run(...messageIds)
    }
  })

  // ---- Rename All Sessions ----

  socket.on('rename_sessions', ({ issueNum, worktreeName, issueTitle, issueUrl }, callback) => {
    console.log(`[Broker] [${session.id}] Renaming all sessions: issue=${issueNum}, worktree=${worktreeName}, title=${issueTitle}`)

    // Store on session object
    session.issueNum = issueNum
    session.worktreeName = worktreeName
    session.issueTitle = issueTitle
    session.issueUrl = issueUrl

    // Broadcast to all agents in this session (including sender)
    io.to(`session:${session.id}:team`).emit('rename_session', { issueNum, worktreeName })

    // Broadcast to dashboard
    io.to(`session:${session.id}:dashboard`).emit('session_metadata', {
      sessionId: session.id,
      issueNum,
      worktreeName,
      issueTitle,
      issueUrl
    })

    if (callback) callback({ success: true, agentCount: session.agents.size })
  })

  // ---- Set Task Summary (Issue Bar) ----

  socket.on('set_task_summary', ({ summary }, callback) => {
    console.log(`[Broker] [${session.id}] Setting task summary: ${summary}`)

    // Store on session object
    session.taskSummary = summary

    // Broadcast to dashboard
    io.to(`session:${session.id}:dashboard`).emit('task_summary', {
      sessionId: session.id,
      summary
    })

    if (callback) callback({ success: true })
  })

  // ---- Sync Workspace (Worktree) ----

  socket.on('sync_workspace', ({ path, action }, callback) => {
    const now = Date.now()
    const SYNC_DEBOUNCE_MS = 5000  // Ignore duplicate syncs within 5 seconds

    // Check for duplicate sync (same path+action within debounce window)
    const syncKey = `${path}:${action}`
    if (session.lastSync && session.lastSync.key === syncKey &&
        (now - session.lastSync.time) < SYNC_DEBOUNCE_MS) {
      console.log(`[Broker] [${session.id}] Ignoring duplicate workspace sync: ${syncKey} (${now - session.lastSync.time}ms since last)`)
      if (callback) callback({ success: true, agentCount: session.agents.size, deduplicated: true })
      return
    }

    // Track this sync for deduplication
    session.lastSync = { key: syncKey, time: now, from: agentRole }

    console.log(`[Broker] [${session.id}] Syncing workspace (from ${agentRole}): path=${path}, action=${action}`)

    // Store the current workspace path in the session for new agents joining later
    if (action === 'switch') {
      session.workspacePath = path

      // Extract worktree name from path and update issue bar
      const worktreeName = path.split('/').pop()
      if (worktreeName && session.issueNum) {
        session.worktreeName = worktreeName
        console.log(`[Broker] [${session.id}] Updated worktree name to: ${worktreeName}`)

        // Broadcast updated metadata to dashboard
        io.to(`session:${session.id}:dashboard`).emit('session_metadata', {
          sessionId: session.id,
          issueNum: session.issueNum,
          worktreeName: session.worktreeName,
          issueTitle: session.issueTitle,
          issueUrl: session.issueUrl
        })
      }
    } else if (action === 'remove') {
      session.workspacePath = null
    }

    // Broadcast to other agents in this session (exclude sender with socket.to)
    socket.to(`session:${session.id}:team`).emit('workspace_sync', { path, action })

    // Also notify dashboards
    io.to(`session:${session.id}:dashboard`).emit('workspace_update', {
      sessionId: session.id,
      path,
      action
    })

    if (callback) callback({ success: true, agentCount: session.agents.size })
  })

  // ---- Terminal Output Streaming ----

  socket.on('agent_output', ({ data }) => {
    // Store in session's output buffer
    const existing = session.outputBuffers.get(agentRole) || ''
    const combined = existing + data
    session.outputBuffers.set(
      agentRole,
      combined.length > MAX_OUTPUT_BUFFER ? combined.slice(-MAX_OUTPUT_BUFFER) : combined
    )

    // Relay to dashboards subscribed to this agent in this session
    const subKey = `${session.id}:${agentRole}`
    for (const [, dashSocket] of io.of('/').sockets) {
      if (dashSocket.data.outputSubs?.has(subKey)) {
        dashSocket.emit('agent_output', { sessionId: session.id, agent: agentRole, data })
      }
    }
  })

  // ---- Roster/History Requests ----

  socket.on('get_roster', (callback) => {
    callback([...session.agents.keys()])
  })

  socket.on('get_messages', ({ since, limit = 50 }, callback) => {
    let query = 'SELECT * FROM messages WHERE session_id = ? AND to_agent IN (?, \'team\')'
    const params = [session.id, agentRole]

    if (since) {
      query += ' AND created_at > ?'
      params.push(since)
    }

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const messages = db.prepare(query).all(...params).reverse()
    callback(messages)
  })

  // ---- Disconnect ----

  socket.on('disconnect', (reason) => {
    if (!isTransient) {
      session.agents.delete(agentRole)
      session.outputBuffers.delete(agentRole)
      io.to(`session:${session.id}:dashboard`).emit('agent_left', {
        sessionId: session.id,
        role: agentRole,
        timestamp: new Date().toISOString()
      })
      console.log(`[Broker] ${agentRole} disconnected from session ${session.id} - reason: ${reason}`)
    }
  })
})

// ============================================================================
// SERVER STARTUP
// ============================================================================

const PORT = process.env.BROKER_PORT || 3100

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                CC DEV TEAM - MESSAGE BROKER                ║
╠════════════════════════════════════════════════════════════╣
║  Status:  RUNNING                                          ║
║  Port:    ${PORT}                                             ║
║  Database: ${join(DATA_DIR, 'messages.db')}
║  Multi-Session: ENABLED                                    ║
╚════════════════════════════════════════════════════════════╝

Waiting for connections...
  `)
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Broker] Shutting down...')

  // Kill all agent processes in all sessions
  for (const [sessionId, session] of sessions) {
    for (const [role, proc] of session.processes) {
      console.log(`[Broker] Killing ${role} in session ${sessionId}`)
      proc.kill('SIGTERM')
    }
  }

  db.close()
  process.exit(0)
})
