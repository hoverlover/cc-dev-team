'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Socket } from 'socket.io-client'
import styles from './ProjectPicker.module.css'

interface DirectoryItem {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

interface DirectoryListing {
  path: string
  parent: string
  items: DirectoryItem[]
  error?: string
}

interface ProjectPickerProps {
  socket: Socket | null
  isOpen: boolean
  onClose: () => void
  onSelectProject: (projectDir: string, projectName: string, agents: string[]) => void
}

const AVAILABLE_AGENTS = [
  { id: 'pm', name: 'Product Manager', description: 'Coordinates the team and manages tasks' },
  { id: 'architect', name: 'Architect', description: 'Designs system architecture' },
  { id: 'engineer', name: 'Engineer', description: 'Implements features and fixes bugs' },
  { id: 'qa-engineer', name: 'QA Engineer', description: 'Tests and validates quality' },
  { id: 'ui-ux', name: 'UI/UX Expert', description: 'Designs user interfaces' },
  { id: 'code-auditor', name: 'Code Auditor', description: 'Reviews code quality and security' },
]

export default function ProjectPicker({ socket, isOpen, onClose, onSelectProject }: ProjectPickerProps) {
  const [currentPath, setCurrentPath] = useState<string>('')
  const [items, setItems] = useState<DirectoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set(['pm']))
  const [projectName, setProjectName] = useState('')

  const loadDirectory = useCallback((path: string) => {
    if (!socket) return

    setLoading(true)
    setError(null)

    socket.emit('list_directory', { path }, (result: DirectoryListing) => {
      setLoading(false)
      if (result.error) {
        setError(result.error)
      } else {
        setCurrentPath(result.path)
        setItems(result.items)
        // Set default project name from directory name
        const dirName = result.path.split('/').pop() || ''
        setProjectName(dirName)
      }
    })
  }, [socket])

  // Load home directory on open
  useEffect(() => {
    if (isOpen && socket) {
      loadDirectory('')
    }
  }, [isOpen, socket, loadDirectory])

  const handleNavigate = (item: DirectoryItem) => {
    if (item.isDirectory) {
      loadDirectory(item.path)
    }
  }

  const handleGoUp = () => {
    if (currentPath) {
      const parent = currentPath.split('/').slice(0, -1).join('/') || '/'
      loadDirectory(parent)
    }
  }

  const handleToggleAgent = (agentId: string) => {
    setSelectedAgents(prev => {
      const next = new Set(prev)
      if (next.has(agentId)) {
        // Don't allow deselecting PM - it's required
        if (agentId !== 'pm') {
          next.delete(agentId)
        }
      } else {
        next.add(agentId)
      }
      return next
    })
  }

  const handleSelectProject = () => {
    if (currentPath && projectName) {
      onSelectProject(currentPath, projectName, Array.from(selectedAgents))
    }
  }

  const handlePathInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      loadDirectory((e.target as HTMLInputElement).value)
    }
  }

  if (!isOpen) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Open Project</h2>
          <button className={styles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.pathBar}>
          <button className={styles.upButton} onClick={handleGoUp} disabled={currentPath === '/'}>
            ..
          </button>
          <input
            type="text"
            className={styles.pathInput}
            value={currentPath}
            onChange={e => setCurrentPath(e.target.value)}
            onKeyDown={handlePathInput}
            placeholder="Enter path..."
          />
          <button className={styles.goButton} onClick={() => loadDirectory(currentPath)}>
            Go
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.fileList}>
            {loading && <div className={styles.loading}>Loading...</div>}
            {error && <div className={styles.error}>{error}</div>}
            {!loading && !error && items.length === 0 && (
              <div className={styles.empty}>Empty directory</div>
            )}
            {!loading && !error && items.map(item => (
              <div
                key={item.path}
                className={`${styles.item} ${item.isDirectory ? styles.directory : styles.file}`}
                onClick={() => handleNavigate(item)}
              >
                <span className={styles.icon}>{item.isDirectory ? '📁' : '📄'}</span>
                <span className={styles.name}>{item.name}</span>
              </div>
            ))}
          </div>

          <div className={styles.agentSelection}>
            <h3>Select Agents to Launch</h3>
            <div className={styles.agentList}>
              {AVAILABLE_AGENTS.map(agent => (
                <label key={agent.id} className={styles.agentOption}>
                  <input
                    type="checkbox"
                    checked={selectedAgents.has(agent.id)}
                    onChange={() => handleToggleAgent(agent.id)}
                    disabled={agent.id === 'pm'} // PM is required
                  />
                  <div className={styles.agentInfo}>
                    <span className={styles.agentName}>{agent.name}</span>
                    <span className={styles.agentDesc}>{agent.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.footer}>
          <div className={styles.projectNameInput}>
            <label>Project Name:</label>
            <input
              type="text"
              value={projectName}
              onChange={e => setProjectName(e.target.value)}
              placeholder="Project name..."
            />
          </div>
          <div className={styles.selectedPath}>
            <strong>Selected:</strong> {currentPath || 'None'}
          </div>
          <div className={styles.actions}>
            <button className={styles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button
              className={styles.selectButton}
              onClick={handleSelectProject}
              disabled={!currentPath || !projectName}
            >
              Open Project ({selectedAgents.size} agent{selectedAgents.size !== 1 ? 's' : ''})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

