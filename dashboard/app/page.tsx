'use client'

import { useEffect, useState, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import styles from './page.module.css'

interface Message {
  id: number
  created_at: string
  from_agent: string
  to_agent: string
  thread_id?: string
  message_type: string
  content: string
}

interface AgentInfo {
  role: string
  status?: string
  connectedAt?: string
}

const KNOWN_AGENTS = ['pm', 'architect', 'engineer-1', 'engineer-2', 'qa', 'code-auditor']
const BROKER_URL = process.env.NEXT_PUBLIC_BROKER_URL || 'http://localhost:3100'

const AGENT_NAMES: Record<string, string> = {
  'pm': 'Project Manager',
  'architect': 'Architect',
  'engineer-1': 'Engineer 1',
  'engineer-2': 'Engineer 2',
  'qa': 'QA Tester',
  'code-auditor': 'Code Auditor',
}

function formatAgentName(agent: string): string {
  return AGENT_NAMES[agent] || agent.charAt(0).toUpperCase() + agent.slice(1)
}

function formatContent(content: string): string {
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed === 'object') {
      return JSON.stringify(parsed, null, 2)
    }
    return content
  } catch {
    return content
  }
}

export default function Dashboard() {
  const [connected, setConnected] = useState(false)
  const [activeAgents, setActiveAgents] = useState<Set<string>>(new Set())
  const [messages, setMessages] = useState<Message[]>([])
  const [projectDir, setProjectDir] = useState<string | null>(null)
  const socketRef = useRef<Socket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

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
      setActiveAgents((prev) => new Set([...prev, role]))
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

    return () => {
      socket.disconnect()
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Agentic Orchestrator</h1>
        <div className={styles.projectInfo}>
          <span className={styles.projectName}>
            {projectDir || 'No project loaded'}
          </span>
          <span className={`${styles.connectionStatus} ${connected ? styles.connected : styles.disconnected}`}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </header>

      <main className={styles.main}>
        <aside className={styles.sidebar}>
          <section className={styles.agentsPanel}>
            <h2>Team</h2>
            <ul className={styles.agentsList}>
              {KNOWN_AGENTS.map((agent) => (
                <li key={agent} className={styles.agentItem}>
                  <span className={`${styles.agentStatusDot} ${activeAgents.has(agent) ? styles.online : ''}`} />
                  <span className={styles.agentName}>{formatAgentName(agent)}</span>
                </li>
              ))}
              {[...activeAgents]
                .filter((agent) => !KNOWN_AGENTS.includes(agent))
                .map((agent) => (
                  <li key={agent} className={styles.agentItem}>
                    <span className={`${styles.agentStatusDot} ${styles.online}`} />
                    <span className={styles.agentName}>{formatAgentName(agent)}</span>
                  </li>
                ))}
            </ul>
          </section>
        </aside>

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
                    <pre>{formatContent(msg.content)}</pre>
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>
        </section>
      </main>
    </div>
  )
}
