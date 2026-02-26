'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Socket } from 'socket.io-client'
import styles from './ProjectPicker.module.css'

interface DirectoryItem {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
}

interface WorktreeItem {
  path: string
  name: string
  branch: string
  commit: string
  isRoot: boolean
  lastModified: string | null
}

interface WorktreeInfo {
  rootPath: string
  rootName: string
  isWorktree: boolean
  list: WorktreeItem[]
}

interface DirectoryListing {
  path: string
  parent: string
  items: DirectoryItem[]
  error?: string
  worktrees?: WorktreeInfo
}

interface ProjectPickerProps {
  socket: Socket | null
  isOpen: boolean
  onClose: () => void
  onSelectProject: (projectDir: string, projectName: string, agents: string[], options: { skipPermissions: boolean }) => void
}

function formatRelativeDate(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(diff / 3600000)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days > 1 ? 's' : ''} ago`
  const months = Math.floor(days / 30)
  return `${months} month${months > 1 ? 's' : ''} ago`
}

// All agents are launched by default - PM decides who to involve based on the task
const ALL_AGENTS = ['pm', 'architect', 'engineer', 'qa-engineer', 'ui-ux', 'code-auditor', 'docs-auditor']

export default function ProjectPicker({ socket, isOpen, onClose, onSelectProject }: ProjectPickerProps) {
  const [loadedPath, setLoadedPath] = useState<string>('') // The actual loaded directory
  const [inputPath, setInputPath] = useState<string>('') // What user types in the input
  const [items, setItems] = useState<DirectoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [skipPermissions, setSkipPermissions] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null)
  const [showWorktreePanel, setShowWorktreePanel] = useState(false)
  const [selectedWorktreeIndex, setSelectedWorktreeIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const worktreeListRef = useRef<HTMLDivElement>(null)

  // Derive filter from input path - if user types beyond the loaded path, use suffix as filter
  const getFilter = (): string => {
    if (!inputPath.startsWith(loadedPath)) return ''
    const suffix = inputPath.slice(loadedPath.length)
    // Remove leading slash if present
    return suffix.startsWith('/') ? suffix.slice(1) : suffix
  }

  const filter = getFilter()
  const filteredItems = filter
    ? items.filter(item => item.name.toLowerCase().includes(filter.toLowerCase()))
    : items

  // Reset highlight when filter changes
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [filter])

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const items = listRef.current.querySelectorAll('[data-item]')
      items[highlightedIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  // Scroll selected worktree into view
  useEffect(() => {
    if (selectedWorktreeIndex >= 0 && worktreeListRef.current) {
      const items = worktreeListRef.current.querySelectorAll('[data-wt-item]')
      items[selectedWorktreeIndex]?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedWorktreeIndex])

  // Keyboard navigation for worktree panel
  useEffect(() => {
    if (!showWorktreePanel || !worktreeInfo) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedWorktreeIndex(prev =>
          prev < worktreeInfo.list.length - 1 ? prev + 1 : prev
        )
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedWorktreeIndex(prev => prev > 0 ? prev - 1 : 0)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        handleSelectWorktree(selectedWorktreeIndex)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        setShowWorktreePanel(false)
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showWorktreePanel, worktreeInfo, selectedWorktreeIndex])

  const handleSelectWorktree = (index: number) => {
    if (!worktreeInfo) return
    const wt = worktreeInfo.list[index]
    setSelectedWorktreeIndex(index)
    setLoadedPath(wt.path)
    setInputPath(wt.path)
    setProjectName(worktreeInfo.rootName)
  }

  const loadDirectory = useCallback((path: string, keepTrailingSlash = false) => {
    if (!socket) return

    setLoading(true)
    setError(null)

    socket.emit('list_directory', { path }, (result: DirectoryListing) => {
      setLoading(false)
      if (result.error) {
        setError(result.error)
        setWorktreeInfo(null)
        setShowWorktreePanel(false)
      } else {
        setLoadedPath(result.path)
        setInputPath(keepTrailingSlash ? result.path + '/' : result.path)
        setItems(result.items)
        const dirName = result.path.split('/').pop() || ''
        setProjectName(dirName)

        // Handle worktree detection
        if (result.worktrees) {
          setWorktreeInfo(result.worktrees)
          if (!result.worktrees.isWorktree) {
            // At repo root with worktrees -> show picker panel
            setShowWorktreePanel(true)
            setSelectedWorktreeIndex(0)
          } else {
            // Inside a worktree -> show context banner (not panel)
            setShowWorktreePanel(false)
          }
        } else {
          setWorktreeInfo(null)
          setShowWorktreePanel(false)
        }
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
    if (loadedPath) {
      const parent = loadedPath.split('/').slice(0, -1).join('/') || '/'
      loadDirectory(parent)
    }
  }

  const handleSelectProject = () => {
    if (loadedPath && projectName) {
      onSelectProject(loadedPath, projectName, ALL_AGENTS, { skipPermissions })
    }
  }

  const handlePathInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev =>
        prev < filteredItems.length - 1 ? prev + 1 : prev
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => prev > 0 ? prev - 1 : -1)
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && filteredItems[highlightedIndex]?.isDirectory) {
        loadDirectory(filteredItems[highlightedIndex].path, true)
        setHighlightedIndex(-1)
      } else if (highlightedIndex >= 0 && filteredItems[highlightedIndex]) {
        setHighlightedIndex(-1)
      } else {
        loadDirectory(inputPath)
      }
    } else if (e.key === 'Escape') {
      setHighlightedIndex(-1)
    }
  }

  const handleInputChange = (newValue: string) => {
    const oldValue = inputPath
    setInputPath(newValue)

    if (newValue.endsWith('/') && !oldValue.endsWith('/')) {
      const pathWithoutSlash = newValue.slice(0, -1)
      const matchingDir = items.find(
        item => item.isDirectory && item.path === pathWithoutSlash
      )
      if (matchingDir) {
        loadDirectory(matchingDir.path, true)
        return
      }
    }

    if (newValue.length < oldValue.length && loadedPath && !newValue.startsWith(loadedPath)) {
      const lastSlash = newValue.lastIndexOf('/')
      if (lastSlash >= 0) {
        const parentPath = newValue.slice(0, lastSlash) || '/'
        loadDirectory(parentPath)
      }
    }
  }

  // Determine if the selected path is a worktree (not root) for button text
  const isWorktreeSelected = worktreeInfo && !worktreeInfo.list.find(w => w.path === loadedPath)?.isRoot

  if (!isOpen) return null

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.header}>
          <h2>Open Project</h2>
          <button className={styles.closeButton} onClick={onClose}>&times;</button>
        </div>

        <div className={styles.pathBar}>
          <button className={styles.upButton} onClick={handleGoUp} disabled={loadedPath === '/'}>
            ..
          </button>
          <input
            type="text"
            className={styles.pathInput}
            value={inputPath}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handlePathInput}
            placeholder="Enter path or filter..."
          />
          <button className={styles.goButton} onClick={() => loadDirectory(inputPath)}>
            Go
          </button>
        </div>

        {/* Worktree context banner (Flow 2: inside a worktree) */}
        {worktreeInfo?.isWorktree && !showWorktreePanel && (
          <div className={styles.worktreeContext}>
            <div className={styles.ctxIcon}>&#9741;</div>
            <div className={styles.ctxInfo}>
              <div className={styles.ctxLabel}>
                Worktree of {worktreeInfo.rootName}
              </div>
              <div className={styles.ctxDetails}>
                <span>Branch: <span className={styles.ctxBranch}>
                  {worktreeInfo.list.find(w => w.path === loadedPath)?.branch}
                </span></span>
                <span className={styles.ctxSeparator}>&bull;</span>
                <span>Root: {worktreeInfo.rootPath.replace(/^\/Users\/[^/]+/, '~')}</span>
              </div>
            </div>
            <button
              className={styles.ctxAction}
              onClick={() => loadDirectory(worktreeInfo.rootPath)}
            >
              View All Worktrees
            </button>
          </div>
        )}

        <div className={styles.content}>
          <div className={`${styles.fileList} ${showWorktreePanel ? styles.fileListDimmed : ''}`} ref={listRef}>
            {loading && <div className={styles.loading}>Loading...</div>}
            {error && <div className={styles.error}>{error}</div>}
            {!loading && !error && filteredItems.length === 0 && (
              <div className={styles.empty}>{filter ? 'No matches' : 'Empty directory'}</div>
            )}
            {!loading && !error && filteredItems.map((item, index) => (
              <div
                key={item.path}
                data-item
                className={`${styles.item} ${item.isDirectory ? styles.directory : styles.file} ${index === highlightedIndex ? styles.highlighted : ''}`}
                onClick={() => handleNavigate(item)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <span className={styles.icon}>{item.isDirectory ? '\uD83D\uDCC1' : '\uD83D\uDCC4'}</span>
                <span className={styles.name}>{item.name}</span>
              </div>
            ))}
          </div>

          {/* Worktree picker panel (Flow 1: repo root with worktrees) */}
          {showWorktreePanel && worktreeInfo && (
            <div className={styles.worktreePanel}>
              <div className={styles.worktreeHeader}>
                <div className={styles.worktreeIcon}>&#9878;</div>
                <div className={styles.worktreeHeaderText}>
                  <h3>This project has worktrees</h3>
                  <p>Choose the project root or a worktree to open</p>
                </div>
                <button
                  className={styles.worktreeDismiss}
                  onClick={() => setShowWorktreePanel(false)}
                >
                  Skip
                </button>
              </div>

              <div className={styles.worktreeList} ref={worktreeListRef}>
                {worktreeInfo.list.map((wt, index) => (
                  <React.Fragment key={wt.path}>
                    {/* Separator after root item */}
                    {index === 1 && (
                      <div className={styles.wtSeparator}>
                        <span className={styles.wtSeparatorLabel}>Worktrees</span>
                        <div className={styles.wtSeparatorLine} />
                      </div>
                    )}
                    <div
                      data-wt-item
                      className={`${styles.worktreeItem} ${index === selectedWorktreeIndex ? styles.worktreeItemActive : ''}`}
                      onClick={() => handleSelectWorktree(index)}
                      onMouseEnter={() => setSelectedWorktreeIndex(index)}
                    >
                      <div className={`${styles.wtIcon} ${wt.isRoot ? styles.wtIconRoot : ''}`}>
                        {wt.isRoot ? '\u2605' : '\u25C9'}
                      </div>
                      <div className={styles.wtInfo}>
                        <div className={styles.wtNameRow}>
                          <span className={styles.wtName}>{wt.name}</span>
                          {wt.isRoot && <span className={styles.wtBadge}>Root</span>}
                        </div>
                        <div className={styles.wtBranch}>
                          <span className={styles.wtBranchIcon}>&#10140;</span>
                          {wt.branch}
                        </div>
                      </div>
                      <div className={styles.wtMeta}>
                        {wt.isRoot ? (
                          <span className={styles.wtPath}>{wt.path.replace(/^\/Users\/[^/]+/, '~')}</span>
                        ) : (
                          <span className={styles.wtDate}>{formatRelativeDate(wt.lastModified)}</span>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                ))}
              </div>

              <div className={styles.keyboardHint}>
                <span><kbd className={styles.kbd}>&uarr;</kbd> <kbd className={styles.kbd}>&darr;</kbd> navigate</span>
                <span><kbd className={styles.kbd}>Enter</kbd> select</span>
                <span><kbd className={styles.kbd}>Esc</kbd> dismiss</span>
              </div>
            </div>
          )}
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
            <strong>Selected:</strong> {loadedPath.replace(/^\/Users\/[^/]+/, '~') || 'None'}
          </div>
          <label className={`${styles.dangerOption} ${skipPermissions ? styles.dangerOptionActive : ''}`}>
            <input
              type="checkbox"
              checked={skipPermissions}
              onChange={e => setSkipPermissions(e.target.checked)}
              className={styles.dangerCheckbox}
            />
            <div>
              <span className={styles.dangerLabel}>Skip permission prompts</span>
              <span className={styles.dangerDescription}>
                Agents will not ask for permission before executing tools. Use only on trusted projects.
              </span>
            </div>
          </label>
          <div className={styles.actions}>
            <button className={styles.cancelButton} onClick={onClose}>
              Cancel
            </button>
            <button
              className={`${styles.selectButton} ${skipPermissions ? styles.selectButtonDanger : ''}`}
              onClick={handleSelectProject}
              disabled={!loadedPath || !projectName}
            >
              {isWorktreeSelected ? 'Open Worktree' : 'Open Project'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
