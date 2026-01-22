import { Server } from 'socket.io'
import { createServer } from 'http'
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = join(__dirname, '..', 'data')

// Ensure data directory exists
mkdirSync(DATA_DIR, { recursive: true })

// Initialize SQLite database for message persistence
const db = new Database(join(DATA_DIR, 'messages.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    thread_id TEXT,
    message_type TEXT NOT NULL,
    content TEXT NOT NULL,
    read INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent);
  CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
`)

const server = createServer()
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
})

// Track active agents
const activeAgents = new Map()

// Track project context
let currentProject = null

io.on('connection', (socket) => {
  const agentRole = socket.handshake.query.agent
  const isDashboard = socket.handshake.query.dashboard === 'true'

  if (isDashboard) {
    console.log(`[Broker] Dashboard connected`)
    socket.join('dashboard')

    // Send current state to dashboard
    socket.emit('roster', [...activeAgents.keys()])
    if (currentProject) {
      socket.emit('project', currentProject)
    }

    // Send recent messages
    const recentMessages = db.prepare(`
      SELECT * FROM messages ORDER BY created_at DESC LIMIT 50
    `).all().reverse()
    socket.emit('message_history', recentMessages)

    return
  }

  console.log(`[Broker] ${agentRole} connected`)

  // Register agent
  activeAgents.set(agentRole, {
    role: agentRole,
    connectedAt: new Date().toISOString(),
    socketId: socket.id,
    status: 'idle'
  })

  // Join agent-specific room and team room
  socket.join(`agent:${agentRole}`)
  socket.join('team')

  // Notify everyone (including dashboard) that agent joined
  io.to('team').to('dashboard').emit('agent_joined', {
    role: agentRole,
    timestamp: new Date().toISOString()
  })

  // Send current project to newly joined agent if one is set
  if (currentProject) {
    socket.emit('message', {
      id: Date.now(),
      created_at: new Date().toISOString(),
      from_agent: 'system',
      to_agent: agentRole,
      message_type: 'PROJECT_INIT',
      content: currentProject
    })
  }

  console.log(`[Broker] Active agents: ${[...activeAgents.keys()].join(', ')}`)

  // Handle sending messages
  socket.on('send_message', (msg, callback) => {
    const { to, threadId, type, content } = msg

    const message = {
      id: Date.now(),
      created_at: new Date().toISOString(),
      from_agent: agentRole,
      to_agent: to,
      thread_id: threadId || null,
      message_type: type,
      content: typeof content === 'string' ? content : JSON.stringify(content)
    }

    // Persist to database
    try {
      db.prepare(`
        INSERT INTO messages (from_agent, to_agent, thread_id, message_type, content)
        VALUES (?, ?, ?, ?, ?)
      `).run(message.from_agent, message.to_agent, message.thread_id, message.message_type, message.content)
    } catch (err) {
      console.error('[Broker] Failed to persist message:', err)
    }

    // Handle PROJECT_INIT specially - store it
    if (type === 'PROJECT_INIT') {
      currentProject = typeof content === 'string' ? JSON.parse(content) : content
      io.to('dashboard').emit('project', currentProject)
    }

    // Route message
    if (to === 'team') {
      // Broadcast to team except sender
      socket.to('team').emit('message', message)
    } else {
      // Direct message to specific agent
      io.to(`agent:${to}`).emit('message', message)
    }

    // Always send to dashboard
    io.to('dashboard').emit('message', message)

    console.log(`[Broker] ${agentRole} → ${to}: ${type}`)

    if (callback) callback({ success: true, messageId: message.id })
  })

  // Handle status updates
  socket.on('status_update', (status) => {
    const agent = activeAgents.get(agentRole)
    if (agent) {
      agent.status = status
      io.to('dashboard').emit('agent_status', { role: agentRole, status })
    }
  })

  // Handle roster requests
  socket.on('get_roster', (callback) => {
    callback([...activeAgents.keys()])
  })

  // Handle message history requests
  socket.on('get_messages', ({ since, limit = 50 }, callback) => {
    let query = 'SELECT * FROM messages WHERE to_agent IN (?, \'team\')'
    const params = [agentRole]

    if (since) {
      query += ' AND created_at > ?'
      params.push(since)
    }

    query += ' ORDER BY created_at DESC LIMIT ?'
    params.push(limit)

    const messages = db.prepare(query).all(...params).reverse()
    callback(messages)
  })

  // Handle disconnect
  socket.on('disconnect', () => {
    activeAgents.delete(agentRole)
    io.to('team').to('dashboard').emit('agent_left', {
      role: agentRole,
      timestamp: new Date().toISOString()
    })
    console.log(`[Broker] ${agentRole} disconnected`)
  })
})

const PORT = process.env.BROKER_PORT || 3100

server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║           AGENTIC ORCHESTRATOR - MESSAGE BROKER            ║
╠════════════════════════════════════════════════════════════╣
║  Status:  RUNNING                                          ║
║  Port:    ${PORT}                                             ║
║  Database: ${join(DATA_DIR, 'messages.db')}
╚════════════════════════════════════════════════════════════╝

Waiting for agents to connect...
  `)
})

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Broker] Shutting down...')
  db.close()
  process.exit(0)
})
