'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import dynamic from 'next/dynamic'
import '@xterm/xterm/css/xterm.css'
import styles from './page.module.css'
import ProjectPicker from '../components/ProjectPicker'

// Dynamic import of XTerminal to avoid SSR issues
const XTerminal = dynamic(() => import('../components/XTerminal'), {
  ssr: false,
  loading: () => <div className={styles.terminalLoading}>Loading terminal...</div>,
})

interface XTerminalHandle {
  write: (data: string) => void
  clear: () => void
  focus: () => void
  getBuffer: () => string
  scrollToBottom: () => void
}

interface Message {
  id: number | string
  created_at: string
  session_id?: string
  from_agent: string
  to_agent: string
  thread_id?: string
  message_type: string
  content: string
}

interface AgentStatus {
  status: 'idle' | 'working' | 'thinking' | 'waiting' | 'waiting_input' | 'offline'
  task?: string
  waitingForInput?: boolean
  updatedAt?: string
}

interface Session {
  id: string
  name: string
  projectDir: string
  agentCount?: number
  createdAt?: string
}

interface SessionState {
  agents: Set<string>
  agentStatuses: Record<string, AgentStatus>
  messages: Message[]
  selectedAgent: string | null
}

const BROKER_URL = process.env.NEXT_PUBLIC_BROKER_URL || 'http://localhost:3100'

const AGENT_NAMES: Record<string, string> = {
  'pm': 'Product Manager',
  'architect': 'Architect',
  'qa-engineer': 'QA Engineer',
  'ui-ux': 'UI/UX Expert',
  'code-auditor': 'Code Auditor',
}

function isEngineer(agent: string): boolean {
  return agent.startsWith('engineer-') || agent === 'engineer'
}

function getEngineerNumber(agent: string): string {
  const match = agent.match(/engineer-(\d+)/)
  return match ? match[1] : '1'
}

function formatAgentName(agent: string): string {
  if (isEngineer(agent)) {
    return `Engineer ${getEngineerNumber(agent)}`
  }
  return AGENT_NAMES[agent] || agent.charAt(0).toUpperCase() + agent.slice(1)
}

function getStatusLabel(status: AgentStatus): string {
  if (status.waitingForInput) return 'Needs Input'
  if (status.task) return status.task
  switch (status.status) {
    case 'thinking': return 'Thinking...'
    case 'working': return 'Working...'
    case 'waiting': return 'Waiting...'
    case 'waiting_input': return 'Needs Input'
    case 'offline': return 'Offline'
    default: return 'Idle'
  }
}

function createEmptySessionState(): SessionState {
  return {
    agents: new Set(),
    agentStatuses: {},
    messages: [],
    selectedAgent: null,
  }
}

export default function Dashboard() {
  const [connected, setConnected] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionStates, setSessionStates] = useState<Record<string, SessionState>>({})
  const [viewMode, setViewMode] = useState<'nodes' | 'chat'>('nodes')
  const [isDragging, setIsDragging] = useState(false)
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [showAddAgent, setShowAddAgent] = useState(false)
  const [agentsToAdd, setAgentsToAdd] = useState<Set<string>>(new Set())

  const socketRef = useRef<Socket | null>(null)
  const xtermRef = useRef<XTerminalHandle | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const selectedAgentRef = useRef<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  const joinSessionRef = useRef<((sessionId: string) => void) | null>(null)

  // Keep refs in sync
  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
    const state = activeSessionId ? sessionStates[activeSessionId] : null
    selectedAgentRef.current = state?.selectedAgent || null
  }, [activeSessionId, sessionStates])

  // Unsubscribe from agent output when switching away from nodes view
  // This ensures the buffer is replayed when switching back
  useEffect(() => {
    if (viewMode === 'chat' && socketRef.current && selectedAgentRef.current && activeSessionIdRef.current) {
      socketRef.current.emit('unsubscribe_output', {
        sessionId: activeSessionIdRef.current,
        agent: selectedAgentRef.current
      })
    }
  }, [viewMode])

  // Get current session state
  const currentSessionState = activeSessionId ? sessionStates[activeSessionId] : null
  const currentSession = sessions.find(s => s.id === activeSessionId)

  // Send keystrokes to broker (for direct terminal typing)
  const handleTerminalData = useCallback((data: string) => {
    if (socketRef.current && selectedAgentRef.current && activeSessionIdRef.current) {
      socketRef.current.emit('agent_input', {
        sessionId: activeSessionIdRef.current,
        agent: selectedAgentRef.current,
        data
      })
    }
  }, [])

  // Subscribe to agent output when terminal is ready
  const handleTerminalReady = useCallback(() => {
    if (socketRef.current && selectedAgentRef.current && activeSessionIdRef.current) {
      socketRef.current.emit('subscribe_output', {
        sessionId: activeSessionIdRef.current,
        agent: selectedAgentRef.current
      })
    }
  }, [])

  // Handle drag events for visual feedback
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Check if we're leaving to an element outside the container
    const relatedTarget = e.relatedTarget as Node | null
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (!socketRef.current || !selectedAgentRef.current || !activeSessionIdRef.current) return

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    for (const file of files) {
      const reader = new FileReader()

      reader.onload = () => {
        const content = reader.result as string
        const isText = file.type.startsWith('text/') ||
          /\.(txt|md|js|ts|tsx|jsx|json|css|html|xml|yaml|yml|py|rb|go|rs|java|c|cpp|h|sh|bash|zsh)$/i.test(file.name)

        if (isText) {
          const message = `[File attached: ${file.name}]\n\`\`\`\n${content}\n\`\`\`\n`
          socketRef.current?.emit('agent_input', {
            sessionId: activeSessionIdRef.current,
            agent: selectedAgentRef.current,
            data: message
          })
        } else {
          socketRef.current?.emit('agent_input', {
            sessionId: activeSessionIdRef.current,
            agent: selectedAgentRef.current,
            data: `[File reference: ${file.name} (${file.type}, ${file.size} bytes)]\n`
          })
        }
      }

      if (file.type.startsWith('text/') ||
          /\.(txt|md|js|ts|tsx|jsx|json|css|html|xml|yaml|yml|py|rb|go|rs|java|c|cpp|h|sh|bash|zsh)$/i.test(file.name)) {
        reader.readAsText(file)
      } else {
        socketRef.current.emit('agent_input', {
          sessionId: activeSessionIdRef.current,
          agent: selectedAgentRef.current,
          data: `[File reference: ${file.name} (${file.type}, ${file.size} bytes)]\n`
        })
      }
    }
  }, [])

  // Handle agent selection within current session
  const handleSelectAgent = useCallback((agent: string | null) => {
    if (!activeSessionId) return

    const currentState = sessionStates[activeSessionId]
    const previousAgent = currentState?.selectedAgent

    // Unsubscribe from previous agent
    if (previousAgent && socketRef.current) {
      socketRef.current.emit('unsubscribe_output', {
        sessionId: activeSessionId,
        agent: previousAgent
      })
    }

    // Update ref synchronously
    selectedAgentRef.current = agent

    // Update session state
    setSessionStates(prev => ({
      ...prev,
      [activeSessionId]: {
        ...(prev[activeSessionId] || createEmptySessionState()),
        selectedAgent: agent
      }
    }))
  }, [activeSessionId, sessionStates])

  // Join a session (for tab switching)
  const joinSession = useCallback((sessionId: string) => {
    if (!socketRef.current) return

    // Leave current session if any
    if (activeSessionIdRef.current) {
      socketRef.current.emit('leave_session', { sessionId: activeSessionIdRef.current })
    }

    // Join new session
    socketRef.current.emit('join_session', { sessionId }, (result: {
      success: boolean
      roster?: string[]
      project?: { project_dir: string }
      error?: string
    }) => {
      if (result.success) {
        // Update refs synchronously BEFORE state update to avoid race condition
        activeSessionIdRef.current = sessionId
        const existingState = sessionStates[sessionId]
        selectedAgentRef.current = existingState?.selectedAgent || null

        setActiveSessionId(sessionId)

        // Initialize session state if not exists
        setSessionStates(prev => {
          if (!prev[sessionId]) {
            return {
              ...prev,
              [sessionId]: {
                ...createEmptySessionState(),
                agents: new Set(result.roster || [])
              }
            }
          }
          return {
            ...prev,
            [sessionId]: {
              ...prev[sessionId],
              agents: new Set(result.roster || [])
            }
          }
        })
      }
    })
  }, [sessionStates])

  // Keep joinSession ref in sync (so socket effect doesn't need to depend on it)
  useEffect(() => {
    joinSessionRef.current = joinSession
  }, [joinSession])

  // Create a new session/project
  const handleCreateSession = useCallback((projectDir: string, projectName: string, agents: string[]) => {
    if (!socketRef.current) return

    socketRef.current.emit('create_session', {
      projectDir,
      name: projectName,
      agents
    }, (result: { success: boolean; session?: Session; error?: string }) => {
      if (result.success && result.session) {
        setShowProjectPicker(false)
        // Join the new session
        joinSession(result.session.id)
      } else {
        console.error('Failed to create session:', result.error)
      }
    })
  }, [joinSession])

  // Toggle agent selection for adding
  const handleToggleAgentToAdd = useCallback((role: string) => {
    setAgentsToAdd(prev => {
      const next = new Set(prev)
      if (next.has(role)) {
        next.delete(role)
      } else {
        next.add(role)
      }
      return next
    })
  }, [])

  // Spawn selected agents in the current session
  const handleSpawnAgents = useCallback(() => {
    if (!socketRef.current || !activeSessionId || agentsToAdd.size === 0) return

    // Spawn each selected agent
    for (const role of agentsToAdd) {
      socketRef.current.emit('spawn_agent', {
        sessionId: activeSessionId,
        role
      }, (result: { success: boolean; error?: string }) => {
        if (!result.success) {
          console.error(`Failed to spawn agent ${role}:`, result.error)
        }
      })
    }

    setAgentsToAdd(new Set())
    setShowAddAgent(false)
  }, [activeSessionId, agentsToAdd])

  // Close a session
  const handleCloseSession = useCallback((sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!socketRef.current) return

    socketRef.current.emit('delete_session', { sessionId }, (result: { success: boolean }) => {
      if (result.success) {
        // Remove from local state
        setSessions(prev => prev.filter(s => s.id !== sessionId))
        setSessionStates(prev => {
          const next = { ...prev }
          delete next[sessionId]
          return next
        })

        // If this was the active session, switch to another
        if (activeSessionId === sessionId) {
          const remaining = sessions.filter(s => s.id !== sessionId)
          if (remaining.length > 0) {
            joinSession(remaining[0].id)
          } else {
            setActiveSessionId(null)
          }
        }
      }
    })
  }, [activeSessionId, sessions, joinSession])

  // Socket connection and event handlers
  useEffect(() => {
    const socket = io(BROKER_URL, {
      query: { dashboard: 'true' },
      reconnection: true,
      reconnectionDelay: 1000,
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
    })

    socket.on('disconnect', () => {
      setConnected(false)
    })

    // Receive list of existing sessions
    socket.on('sessions', (sessionList: Session[]) => {
      setSessions(sessionList)
      // Auto-join first session if exists and we're not in one
      if (sessionList.length > 0 && !activeSessionIdRef.current && joinSessionRef.current) {
        joinSessionRef.current(sessionList[0].id)
      }
    })

    // New session created
    socket.on('session_created', (session: Session) => {
      setSessions(prev => [...prev, session])
    })

    // Session deleted
    socket.on('session_deleted', ({ sessionId }: { sessionId: string }) => {
      setSessions(prev => prev.filter(s => s.id !== sessionId))
    })

    // Agent joined a session
    socket.on('agent_joined', ({ sessionId, role }: { sessionId: string; role: string }) => {
      setSessionStates(prev => {
        const state = prev[sessionId] || createEmptySessionState()
        const newAgents = new Set(state.agents)
        newAgents.add(role)
        return {
          ...prev,
          [sessionId]: { ...state, agents: newAgents }
        }
      })

      // Add system message
      if (sessionId === activeSessionIdRef.current) {
        setSessionStates(prev => {
          const state = prev[sessionId]
          if (!state) return prev
          return {
            ...prev,
            [sessionId]: {
              ...state,
              messages: [...state.messages, {
                id: crypto.randomUUID(),
                created_at: new Date().toISOString(),
                session_id: sessionId,
                from_agent: 'system',
                to_agent: 'team',
                message_type: 'SYSTEM',
                content: `${formatAgentName(role)} joined`,
              }]
            }
          }
        })
      }
    })

    // Agent left a session
    socket.on('agent_left', ({ sessionId, role }: { sessionId: string; role: string }) => {
      setSessionStates(prev => {
        const state = prev[sessionId]
        if (!state) return prev

        const newAgents = new Set(state.agents)
        newAgents.delete(role)

        const { [role]: _, ...restStatuses } = state.agentStatuses

        return {
          ...prev,
          [sessionId]: {
            ...state,
            agents: newAgents,
            agentStatuses: restStatuses,
            messages: [...state.messages, {
              id: crypto.randomUUID(),
              created_at: new Date().toISOString(),
              session_id: sessionId,
              from_agent: 'system',
              to_agent: 'team',
              message_type: 'SYSTEM',
              content: `${formatAgentName(role)} left`,
            }]
          }
        }
      })
    })

    // Agent status update
    socket.on('agent_status', ({ sessionId, role, status, task, waitingForInput }: {
      sessionId: string
      role: string
      status: string
      task?: string
      waitingForInput?: boolean
    }) => {
      setSessionStates(prev => {
        const state = prev[sessionId]
        if (!state) return prev
        return {
          ...prev,
          [sessionId]: {
            ...state,
            agentStatuses: {
              ...state.agentStatuses,
              [role]: {
                status: status as AgentStatus['status'],
                task,
                waitingForInput,
                updatedAt: new Date().toISOString(),
              }
            }
          }
        }
      })
    })

    // Message history for a session
    socket.on('message_history', ({ sessionId, messages }: { sessionId: string; messages: Message[] }) => {
      setSessionStates(prev => {
        const state = prev[sessionId] || createEmptySessionState()
        return {
          ...prev,
          [sessionId]: { ...state, messages }
        }
      })
    })

    // New message
    socket.on('message', (msg: Message) => {
      const sessionId = msg.session_id || activeSessionIdRef.current
      if (!sessionId) return

      setSessionStates(prev => {
        const state = prev[sessionId]
        if (!state) return prev
        return {
          ...prev,
          [sessionId]: {
            ...state,
            messages: [...state.messages, msg]
          }
        }
      })
    })

    // Terminal output
    socket.on('agent_output', ({ sessionId, agent, data }: { sessionId: string; agent: string; data: string }) => {
      if (sessionId === activeSessionIdRef.current && agent === selectedAgentRef.current && xtermRef.current) {
        xtermRef.current.write(data)
      }
    })

    return () => {
      socket.disconnect()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Empty deps - socket connection should only be created once

  // Scroll messages to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentSessionState?.messages])

  // Sort agents
  const allAgents = currentSessionState
    ? Array.from(currentSessionState.agents).sort((a, b) => {
        const order = ['pm', 'architect', 'qa', 'ui-ux', 'code-auditor']
        const aIdx = order.findIndex(o => a === o)
        const bIdx = order.findIndex(o => b === o)
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
        if (aIdx !== -1) return -1
        if (bIdx !== -1) return 1
        return a.localeCompare(b)
      })
    : []

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>CC Dev Team</h1>
        <div className={styles.headerControls}>
          <div className={styles.viewToggle}>
            <button
              className={`${styles.viewButton} ${viewMode === 'nodes' ? styles.active : ''}`}
              onClick={() => setViewMode('nodes')}
            >
              Agents
            </button>
            <button
              className={`${styles.viewButton} ${viewMode === 'chat' ? styles.active : ''}`}
              onClick={() => setViewMode('chat')}
            >
              Messages
            </button>
          </div>
          <span className={`${styles.connectionStatus} ${connected ? styles.connected : styles.disconnected}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </header>

      {/* Session tabs */}
      <div className={styles.sessionTabs}>
        {sessions.map(session => (
          <div
            key={session.id}
            className={`${styles.sessionTab} ${session.id === activeSessionId ? styles.activeTab : ''}`}
            onClick={() => joinSession(session.id)}
          >
            <span className={styles.sessionName}>{session.name}</span>
            <button
              className={styles.closeTab}
              onClick={(e) => handleCloseSession(session.id, e)}
              title="Close session"
            >
              &times;
            </button>
          </div>
        ))}
        <button
          className={styles.newSessionButton}
          onClick={() => setShowProjectPicker(true)}
          title="Open new project"
        >
          + New Project
        </button>
      </div>

      <main className={styles.main}>
        {!activeSessionId ? (
          <div className={styles.noSession}>
            <h2>No Project Open</h2>
            <p>Open a project to get started with your AI team.</p>
            <button
              className={styles.openProjectButton}
              onClick={() => setShowProjectPicker(true)}
            >
              Open Project
            </button>
          </div>
        ) : viewMode === 'nodes' ? (
          <>
            {/* Agent sidebar */}
            <aside className={styles.agentSidebar}>
              <div className={styles.sidebarHeader}>
                <h2>Agents</h2>
                <span className={styles.agentCount}>{allAgents.length} online</span>
              </div>
              <div className={styles.agentList}>
                {allAgents.map((agent) => {
                  const status = currentSessionState?.agentStatuses[agent] || { status: 'idle' }
                  const isSelected = currentSessionState?.selectedAgent === agent
                  const needsInput = status.waitingForInput || status.status === 'waiting_input'

                  return (
                    <div
                      key={agent}
                      className={`${styles.agentCard} ${isSelected ? styles.selected : ''} ${needsInput ? styles.needsInput : ''}`}
                      onClick={() => !isSelected && handleSelectAgent(agent)}
                    >
                      <div className={styles.agentCardHeader}>
                        <span className={`${styles.statusDot} ${styles[status.status] || styles.idle} ${needsInput ? styles.needsInput : ''}`} />
                        <span className={styles.agentName}>{formatAgentName(agent)}</span>
                        {needsInput && <span className={styles.inputBadge}>!</span>}
                      </div>
                      <div className={styles.agentCardStatus}>
                        {getStatusLabel(status)}
                      </div>
                    </div>
                  )
                })}
                {allAgents.length === 0 && (
                  <div className={styles.emptyAgents}>
                    <p>No agents online</p>
                    <p className={styles.hint}>Agents are starting...</p>
                  </div>
                )}

                {/* Add Agent button */}
                <div className={styles.addAgentSection}>
                  <button
                    className={styles.addAgentButton}
                    onClick={() => {
                      setShowAddAgent(!showAddAgent)
                      if (showAddAgent) setAgentsToAdd(new Set())
                    }}
                  >
                    + Add Agent
                  </button>
                  {showAddAgent && (
                    <div className={styles.addAgentMenu}>
                      {['pm', 'architect', 'engineer', 'qa-engineer', 'ui-ux', 'code-auditor']
                        .filter(role => !allAgents.includes(role))
                        .map(role => (
                          <label key={role} className={styles.addAgentOption}>
                            <input
                              type="checkbox"
                              checked={agentsToAdd.has(role)}
                              onChange={() => handleToggleAgentToAdd(role)}
                            />
                            <span>{formatAgentName(role)}</span>
                          </label>
                        ))}
                      {['pm', 'architect', 'engineer', 'qa-engineer', 'ui-ux', 'code-auditor']
                        .filter(role => !allAgents.includes(role)).length === 0 ? (
                        <div className={styles.allAgentsRunning}>All agents running</div>
                      ) : (
                        <button
                          className={styles.launchAgentsButton}
                          onClick={handleSpawnAgents}
                          disabled={agentsToAdd.size === 0}
                        >
                          Launch {agentsToAdd.size > 0 ? `(${agentsToAdd.size})` : ''}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </aside>

            {/* Terminal panel */}
            <section className={styles.terminalSection}>
              {currentSessionState?.selectedAgent ? (
                <>
                  <div className={styles.terminalHeader}>
                    <span className={styles.terminalTitle}>
                      {formatAgentName(currentSessionState.selectedAgent)}
                      {currentSessionState.agentStatuses[currentSessionState.selectedAgent]?.waitingForInput && (
                        <span className={styles.inputRequired}> - Input Required</span>
                      )}
                    </span>
                    <div className={styles.terminalActions}>
                      <span className={styles.terminalSize}>120x40</span>
                      <button
                        className={styles.terminalClose}
                        onClick={() => handleSelectAgent(null)}
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                  <div
                    className={`${styles.terminalWrapper} ${isDragging ? styles.dragOver : ''}`}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                    onDragOver={handleDragOver}
                    onDrop={handleDrop}
                  >
                    <XTerminal
                      key={`${activeSessionId}-${currentSessionState.selectedAgent}`}
                      forwardedRef={xtermRef}
                      className={styles.terminal}
                      onData={handleTerminalData}
                      onReady={handleTerminalReady}
                    />
                  </div>
                </>
              ) : (
                <div className={styles.noSelection}>
                  <h3>Select an agent</h3>
                  <p>Click on an agent to view their terminal output</p>
                </div>
              )}
            </section>
          </>
        ) : (
          <section className={styles.chatPanel}>
            <div className={styles.messagesContainer}>
              {(currentSessionState?.messages.length || 0) === 0 ? (
                <div className={styles.emptyState}>
                  <h3>No messages yet</h3>
                  <p>Messages between agents will appear here</p>
                </div>
              ) : (
                currentSessionState?.messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`${styles.message} ${msg.from_agent === 'system' ? styles.systemMessage : ''}`}
                  >
                    {msg.from_agent !== 'system' && (
                      <div className={styles.messageHeader}>
                        <span>
                          <span className={styles.messageType}>{msg.message_type}</span>
                          <span className={`${styles.messageFrom} ${styles[msg.from_agent.replace('-', '')]}`}>
                            {formatAgentName(msg.from_agent)}
                          </span>
                          <span className={styles.messageTo}>
                            to {msg.to_agent === 'team' ? 'team' : formatAgentName(msg.to_agent)}
                          </span>
                        </span>
                        <span className={styles.messageMeta}>
                          {new Date(msg.created_at).toLocaleTimeString('en-US', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    )}
                    <div className={styles.messageContent}>
                      <pre>{msg.content}</pre>
                    </div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </section>
        )}
      </main>

      {/* Project picker modal */}
      <ProjectPicker
        socket={socketRef.current}
        isOpen={showProjectPicker}
        onClose={() => setShowProjectPicker(false)}
        onSelectProject={handleCreateSession}
      />
    </div>
  )
}
