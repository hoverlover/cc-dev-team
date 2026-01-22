'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import dynamic from 'next/dynamic'
import '@xterm/xterm/css/xterm.css'
import styles from './page.module.css'

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
}

interface Message {
  id: number
  created_at: string
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

interface AgentInfo {
  headless?: boolean
  terminalSize?: { cols: number; rows: number }
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

export default function Dashboard() {
  const [connected, setConnected] = useState(false)
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set())
  const [agentStatuses, setAgentStatuses] = useState<Record<string, AgentStatus>>({})
  const [agentInfos, setAgentInfos] = useState<Record<string, AgentInfo>>({})
  const [messages, setMessages] = useState<Message[]>([])
  const [projectDir, setProjectDir] = useState<string | null>(null)
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'nodes' | 'chat'>('nodes')
  const [isDragging, setIsDragging] = useState(false)

  const socketRef = useRef<Socket | null>(null)
  const xtermRef = useRef<XTerminalHandle | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const selectedAgentRef = useRef<string | null>(null)

  // Keep selectedAgentRef in sync for use in socket handler
  useEffect(() => {
    selectedAgentRef.current = selectedAgent
  }, [selectedAgent])

  // Send keystrokes to broker
  const handleTerminalData = useCallback((data: string) => {
    if (socketRef.current && selectedAgentRef.current) {
      socketRef.current.emit('agent_input', {
        agent: selectedAgentRef.current,
        data
      })
    }
  }, [])

  // Subscribe to agent output when terminal is ready
  const handleTerminalReady = useCallback(() => {
    if (socketRef.current && selectedAgentRef.current) {
      socketRef.current.emit('subscribe_output', { agent: selectedAgentRef.current })
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
    // Only set to false if we're leaving the drop zone entirely
    if (e.currentTarget === e.target) {
      setIsDragging(false)
    }
  }, [])

  // Handle drag over - prevent default to allow drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  // Handle file drop - send files to agent
  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    if (!socketRef.current || !selectedAgentRef.current) return

    const files = Array.from(e.dataTransfer.files)
    if (files.length === 0) return

    // Process each dropped file
    for (const file of files) {
      // Read file content
      const reader = new FileReader()

      reader.onload = () => {
        const content = reader.result as string
        const isText = file.type.startsWith('text/') ||
          /\.(txt|md|js|ts|tsx|jsx|json|css|html|xml|yaml|yml|py|rb|go|rs|java|c|cpp|h|sh|bash|zsh)$/i.test(file.name)

        if (isText) {
          // For text files, send the path and content as a prompt
          const message = `[File attached: ${file.name}]\n\`\`\`\n${content}\n\`\`\`\n`
          socketRef.current?.emit('agent_input', {
            agent: selectedAgentRef.current,
            data: message
          })
        } else {
          // For binary files, just send the path reference
          socketRef.current?.emit('agent_input', {
            agent: selectedAgentRef.current,
            data: `[File reference: ${file.name} (${file.type}, ${file.size} bytes)]\n`
          })
        }
      }

      if (file.type.startsWith('text/') ||
          /\.(txt|md|js|ts|tsx|jsx|json|css|html|xml|yaml|yml|py|rb|go|rs|java|c|cpp|h|sh|bash|zsh)$/i.test(file.name)) {
        reader.readAsText(file)
      } else {
        // For binary files, just reference them
        socketRef.current.emit('agent_input', {
          agent: selectedAgentRef.current,
          data: `[File reference: ${file.name} (${file.type}, ${file.size} bytes)]\n`
        })
      }
    }
  }, [])

  // Handle agent selection - subscription happens in onReady callback
  const handleSelectAgent = useCallback((agent: string | null) => {
    // Unsubscribe from previous agent
    if (selectedAgent && socketRef.current) {
      socketRef.current.emit('unsubscribe_output', { agent: selectedAgent })
    }

    // Update ref synchronously BEFORE state update triggers re-render
    // This ensures handleTerminalReady has the correct agent when onReady fires
    selectedAgentRef.current = agent

    setSelectedAgent(agent)
    // Note: subscription to new agent happens in handleTerminalReady
    // when the terminal component signals it's ready
  }, [selectedAgent])

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

    socket.on('roster', (agents: string[]) => {
      setActiveAgents(new Set(agents))
    })

    socket.on('project', (project: { project_dir: string }) => {
      if (project?.project_dir) {
        setProjectDir(project.project_dir)
      }
    })

    socket.on('message_history', (msgs: Message[]) => {
      setMessages(msgs)
    })

    socket.on('message', (msg: Message) => {
      setMessages((prev) => [...prev, msg])
    })

    socket.on('agent_joined', ({ role }: { role: string }) => {
      setActiveAgents((prev) => new Set([...Array.from(prev), role]))
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          created_at: new Date().toISOString(),
          from_agent: 'system',
          to_agent: 'team',
          message_type: 'SYSTEM',
          content: `${formatAgentName(role)} joined`,
        },
      ])
    })

    socket.on('agent_left', ({ role }: { role: string }) => {
      setActiveAgents((prev) => {
        const next = new Set(prev)
        next.delete(role)
        return next
      })
      setAgentStatuses((prev) => {
        const next = { ...prev }
        delete next[role]
        return next
      })
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          created_at: new Date().toISOString(),
          from_agent: 'system',
          to_agent: 'team',
          message_type: 'SYSTEM',
          content: `${formatAgentName(role)} left`,
        },
      ])
    })

    socket.on('agent_status', ({ role, status, task, waitingForInput }: {
      role: string
      status: string
      task?: string
      waitingForInput?: boolean
    }) => {
      setAgentStatuses((prev) => ({
        ...prev,
        [role]: {
          status: status as AgentStatus['status'],
          task,
          waitingForInput,
          updatedAt: new Date().toISOString(),
        },
      }))
    })

    socket.on('agent_info', ({ role, headless, terminalSize }: {
      role: string
      headless?: boolean
      terminalSize?: { cols: number; rows: number }
    }) => {
      setAgentInfos((prev) => ({
        ...prev,
        [role]: { headless, terminalSize }
      }))
    })

    // Handle streaming terminal output from agents
    socket.on('agent_output', ({ agent, data }: { agent: string; data: string }) => {
      // Write to terminal if this is the currently selected agent
      if (agent === selectedAgentRef.current && xtermRef.current) {
        xtermRef.current.write(data)
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Sort agents: PM first, then architects, engineers, others
  const allAgents = Array.from(activeAgents).sort((a, b) => {
    const order = ['pm', 'architect', 'qa', 'ui-ux', 'code-auditor']
    const aIdx = order.findIndex(o => a === o)
    const bIdx = order.findIndex(o => b === o)
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
    if (aIdx !== -1) return -1
    if (bIdx !== -1) return 1
    return a.localeCompare(b)
  })

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Agentic Orchestrator</h1>
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
          <div className={styles.projectInfo}>
            <span className={styles.projectName}>
              {projectDir || 'No project loaded'}
            </span>
            <span className={`${styles.connectionStatus} ${connected ? styles.connected : styles.disconnected}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </header>

      <main className={styles.main}>
        {viewMode === 'nodes' ? (
          <>
            {/* Single column agent sidebar */}
            <aside className={styles.agentSidebar}>
              <div className={styles.sidebarHeader}>
                <h2>Agents</h2>
                <span className={styles.agentCount}>{allAgents.length} online</span>
              </div>
              <div className={styles.agentList}>
                {allAgents.map((agent) => {
                  const status = agentStatuses[agent] || { status: 'idle' }
                  const isSelected = selectedAgent === agent
                  const needsInput = status.waitingForInput || status.status === 'waiting_input'

                  return (
                    <div
                      key={agent}
                      className={`${styles.agentCard} ${isSelected ? styles.selected : ''} ${needsInput ? styles.needsInput : ''}`}
                      onClick={() => handleSelectAgent(isSelected ? null : agent)}
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
                    <p className={styles.hint}>Start agents to see them here</p>
                  </div>
                )}
              </div>
            </aside>

            {/* Terminal panel - takes remaining width */}
            <section className={styles.terminalSection}>
              {selectedAgent ? (
                <>
                  <div className={styles.terminalHeader}>
                    <span className={styles.terminalTitle}>
                      {formatAgentName(selectedAgent)}
                      {agentStatuses[selectedAgent]?.waitingForInput && (
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
                      key={selectedAgent}
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
              {messages.length === 0 ? (
                <div className={styles.emptyState}>
                  <h3>No messages yet</h3>
                  <p>Messages between agents will appear here</p>
                </div>
              ) : (
                messages.map((msg) => (
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
    </div>
  )
}
