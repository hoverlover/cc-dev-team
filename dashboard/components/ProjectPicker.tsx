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
  onSelectProject: (projectDir: string, projectName: string, agents: string[], options: { skipPermissions: boolean }) => void
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
  const [showHidden, setShowHidden] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1)
  const listRef = useRef<HTMLDivElement>(null)

  // Derive filter from input path - if user types beyond the loaded path, use suffix as filter
  const getFilter = (): string => {
    if (!inputPath.startsWith(loadedPath)) return ''
    const suffix = inputPath.slice(loadedPath.length)
    // Remove leading slash if present
    return suffix.startsWith('/') ? suffix.slice(1) : suffix
  }

  const filter = getFilter()
  const visibleItems = showHidden ? items : items.filter(item => !item.name.startsWith('.'))
  const filteredItems = filter
    ? visibleItems.filter(item => item.name.toLowerCase().includes(filter.toLowerCase()))
    : visibleItems

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

  const loadDirectory = useCallback((path: string, keepTrailingSlash = false) => {
    if (!socket) return

    setLoading(true)
    setError(null)

    socket.emit('list_directory', { path }, (result: DirectoryListing) => {
      setLoading(false)
      if (result.error) {
        setError(result.error)
      } else {
        setLoadedPath(result.path)
        // Add trailing slash if requested (for seamless typing experience)
        setInputPath(keepTrailingSlash ? result.path + '/' : result.path)
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
      // First arrow down goes to 0, subsequent ones increment
      setHighlightedIndex(prev =>
        prev < filteredItems.length - 1 ? prev + 1 : prev
      )
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => prev > 0 ? prev - 1 : -1)
    } else if (e.key === 'Enter') {
      // If an item is highlighted, navigate to it
      if (highlightedIndex >= 0 && filteredItems[highlightedIndex]?.isDirectory) {
        loadDirectory(filteredItems[highlightedIndex].path, true)
        setHighlightedIndex(-1)
      } else if (highlightedIndex >= 0 && filteredItems[highlightedIndex]) {
        // Non-directory item highlighted - just clear highlight
        setHighlightedIndex(-1)
      } else {
        // No highlight - try to navigate to typed path
        loadDirectory(inputPath)
      }
    } else if (e.key === 'Escape') {
      // Clear highlight
      setHighlightedIndex(-1)
    }
  }

  const handleInputChange = (newValue: string) => {
    const oldValue = inputPath
    setInputPath(newValue)

    // Check if user typed a slash - try to navigate into matching directory
    if (newValue.endsWith('/') && !oldValue.endsWith('/')) {
      const pathWithoutSlash = newValue.slice(0, -1)
      // Check if this matches a directory in current listing
      const matchingDir = items.find(
        item => item.isDirectory && item.path === pathWithoutSlash
      )
      if (matchingDir) {
        loadDirectory(matchingDir.path, true) // Keep trailing slash for seamless typing
        return
      }
    }

    // Check if user backspaced past the loaded directory - navigate up
    if (newValue.length < oldValue.length && loadedPath && !newValue.startsWith(loadedPath)) {
      // Find the parent directory from the new input
      const lastSlash = newValue.lastIndexOf('/')
      if (lastSlash >= 0) {
        const parentPath = newValue.slice(0, lastSlash) || '/'
        loadDirectory(parentPath)
      }
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
          <button
            className={`${styles.toggleHidden} ${showHidden ? styles.toggleHiddenActive : ''}`}
            onClick={() => setShowHidden(prev => !prev)}
            title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}
          >
            .*
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.fileList} ref={listRef}>
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
                <span className={styles.icon}>{item.isDirectory ? '📁' : '📄'}</span>
                <span className={styles.name}>{item.name}</span>
              </div>
            ))}
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
            <strong>Selected:</strong> {loadedPath || 'None'}
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
              Open Project
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

