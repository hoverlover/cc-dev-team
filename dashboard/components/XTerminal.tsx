'use client'

import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react'
import { Terminal, ILinkProvider, IBufferCellPosition, ILink } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { FILE_PATH_REGEX, parseFilePath, resolveFilePath, findFilePathsInLine } from '../lib/filePathMatcher'
// Note: xterm.css is imported in page.tsx to avoid CSS chunk loading issues with dynamic imports

// Minimum terminal size (scrollbars if container is smaller)
const MIN_COLS = 80
const MIN_ROWS = 24

export interface XTerminalHandle {
  write: (data: string) => void
  clear: () => void
  focus: () => void
  getBuffer: () => string
  scrollToBottom: () => void
}

interface XTerminalProps {
  className?: string
  onData?: (data: string) => void // Callback for keyboard input
  onReady?: () => void // Callback when terminal is ready to receive data
  onResize?: (cols: number, rows: number) => void // Callback when terminal is resized
  forwardedRef?: React.Ref<XTerminalHandle> // For dynamic import compatibility
  projectDir?: string // Project directory for resolving relative file paths
  onFileClick?: (filePath: string, line?: number, col?: number) => void // Callback when file path is clicked
}

// Terminal theme - lighter muted dark for visual separation
const terminalTheme = {
  background: '#28282e',
  foreground: '#e4e4e8',
  cursor: 'transparent',
  cursorAccent: 'transparent',
  selectionBackground: 'rgba(139, 92, 246, 0.35)',
  black: '#28282e',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#a78bfa',
  cyan: '#22d3ee',
  white: '#e4e4e8',
  brightBlack: '#78788a',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fcd34d',
  brightBlue: '#93c5fd',
  brightMagenta: '#c4b5fd',
  brightCyan: '#67e8f9',
  brightWhite: '#ffffff',
}

const XTerminal = forwardRef<XTerminalHandle, XTerminalProps>(({ className, onData, onReady, onResize, forwardedRef, projectDir, onFileClick }, ref) => {
  // Use forwardedRef if provided (from dynamic import wrapper), otherwise use ref
  const actualRef = forwardedRef || ref
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [isReady, setIsReady] = useState(false)
  // Track whether we're pinned to bottom (starts pinned)
  const pinnedToBottomRef = useRef(true)
  // Track disposal state to prevent operations on disposed terminal
  const isDisposedRef = useRef(false)

  useImperativeHandle(actualRef, () => ({
    write: (data: string) => {
      if (isDisposedRef.current) return
      if (terminalRef.current) {
        try {
          const terminal = terminalRef.current
          const buffer = terminal.buffer.active
          // Capture pinned state and viewport position BEFORE writing
          // (write might trigger scroll via escape sequences like \x1b[H cursor home)
          const shouldScroll = pinnedToBottomRef.current
          const previousViewportY = buffer.viewportY

          terminal.write(data)

          if (shouldScroll) {
            terminal.scrollToBottom()
          } else {
            // Restore viewport position if user was scrolled up
            // This prevents escape sequences in the output from jumping the viewport
            const currentViewportY = buffer.viewportY
            if (currentViewportY !== previousViewportY) {
              terminal.scrollToLine(previousViewportY)
            }
          }
        } catch {
          // Terminal may be partially disposed
        }
      }
    },
    clear: () => {
      if (isDisposedRef.current) return
      terminalRef.current?.clear()
    },
    focus: () => {
      if (isDisposedRef.current) return
      terminalRef.current?.focus()
      // Don't force scroll on focus - respect user's pinned state
    },
    getBuffer: () => {
      if (isDisposedRef.current || !terminalRef.current) return ''
      try {
        const buffer = terminalRef.current.buffer.active
        const lines: string[] = []
        for (let i = 0; i < buffer.length; i++) {
          const line = buffer.getLine(i)
          if (line) {
            lines.push(line.translateToString())
          }
        }
        return lines.join('\n')
      } catch {
        return ''
      }
    },
    scrollToBottom: () => {
      if (isDisposedRef.current) return
      pinnedToBottomRef.current = true
      terminalRef.current?.scrollToBottom()
    },
  }), [isReady])

  useEffect(() => {
    if (!containerRef.current) return

    // Reset disposed flag for new terminal instance
    isDisposedRef.current = false

    // Create terminal - FitAddon will set actual size based on container
    const terminal = new Terminal({
      // Hide xterm's cursor - Claude Code renders its own cursor
      cursorBlink: false,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'none',
      disableStdin: false, // Enable keyboard input
      convertEol: true,
      scrollback: 10000,
      fontSize: 13,
      // JetBrainsMono Nerd Font is loaded via CSS @font-face from CDN
      // Local Nerd Fonts are tried first for faster loading if available
      fontFamily: '"MesloLGS Nerd Font", "MesloLGS NF", "JetBrainsMono Nerd Font", "FiraCode Nerd Font", "Hack Nerd Font", Menlo, Monaco, "Courier New", monospace',
      theme: terminalTheme,
    })

    // Add FitAddon for dynamic resizing
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    fitAddonRef.current = fitAddon

    // Add web links addon for clickable URLs
    const webLinksAddon = new WebLinksAddon()
    terminal.loadAddon(webLinksAddon)

    // Add file path link provider for clickable file paths
    if (onFileClick) {
      const filePathLinkProvider: ILinkProvider = {
        provideLinks: (bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) => {
          const buffer = terminal.buffer.active
          const line = buffer.getLine(bufferLineNumber - 1)
          if (!line) {
            callback(undefined)
            return
          }

          const lineText = line.translateToString()
          const matches = findFilePathsInLine(lineText)

          if (matches.length === 0) {
            callback(undefined)
            return
          }

          const links: ILink[] = matches.map(match => ({
            range: {
              start: { x: match.startIndex + 1, y: bufferLineNumber },
              end: { x: match.endIndex + 1, y: bufferLineNumber }
            },
            text: lineText.substring(match.startIndex, match.endIndex),
            decorations: {
              underline: true,
              pointerCursor: true
            },
            activate: () => {
              const resolvedPath = resolveFilePath(match.path, projectDir)
              onFileClick(resolvedPath, match.line, match.column)
            }
          }))

          callback(links)
        }
      }

      terminal.registerLinkProvider(filePathLinkProvider)
    }

    // Open terminal in container
    terminal.open(containerRef.current)
    terminalRef.current = terminal

    // Initial fit after opening - defer to next frame so xterm viewport is ready
    requestAnimationFrame(() => {
      if (isDisposedRef.current) return
      try {
        fitAddon.fit()
        // Enforce minimum size
        const cols = Math.max(terminal.cols, MIN_COLS)
        const rows = Math.max(terminal.rows, MIN_ROWS)
        if (terminal.cols !== cols || terminal.rows !== rows) {
          terminal.resize(cols, rows)
        }
        // Notify parent of initial size
        if (onResize) {
          onResize(terminal.cols, terminal.rows)
        }
      } catch (e) {
        console.warn('[XTerminal] Initial fit failed:', e)
      }
    })

    setIsReady(true)

    // Debounced resize handler
    let resizeTimeout: NodeJS.Timeout | null = null
    const handleResize = () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      resizeTimeout = setTimeout(() => {
        // Check disposed flag FIRST to avoid operations on disposed terminal
        if (isDisposedRef.current) return
        if (fitAddonRef.current && terminalRef.current) {
          try {
            fitAddonRef.current.fit()
            const t = terminalRef.current
            // Enforce minimum size
            const newCols = Math.max(t.cols, MIN_COLS)
            const newRows = Math.max(t.rows, MIN_ROWS)
            if (t.cols !== newCols || t.rows !== newRows) {
              t.resize(newCols, newRows)
            }
            // Notify parent of new size
            if (onResize) {
              onResize(t.cols, t.rows)
            }
            console.log(`[XTerminal] Resized to ${t.cols}x${t.rows}`)
          } catch (e) {
            // Terminal may be partially disposed, ignore errors
            console.warn('[XTerminal] Resize failed (terminal may be disposed):', e)
          }
        }
      }, 100) // 100ms debounce
    }

    // ResizeObserver for container size changes
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(containerRef.current)

    // Check if at bottom - used to determine if we should auto-scroll
    const isAtBottom = () => {
      if (isDisposedRef.current) return true
      try {
        const buffer = terminal.buffer.active
        const distanceFromBottom = buffer.baseY - buffer.viewportY
        return distanceFromBottom <= 1
      } catch {
        return true
      }
    }

    // IMPORTANT: xterm's onScroll does NOT fire on user scroll (known bug)
    // We must listen to wheel events on the container directly
    // See: https://github.com/xtermjs/xterm.js/issues/3864
    // ONLY user wheel events can unpin (set to false) - this prevents
    // automatic scroll events during large writes from incorrectly unpinning
    const handleWheel = () => {
      if (isDisposedRef.current) return
      requestAnimationFrame(() => {
        if (isDisposedRef.current) return
        pinnedToBottomRef.current = isAtBottom()
      })
    }
    containerRef.current.addEventListener('wheel', handleWheel)

    // onScroll/onLineFeed fire during writes - these should only RE-PIN
    // if we've reached the bottom, never unpin (that's only for user scroll)
    const maybeRepin = () => {
      if (isDisposedRef.current) return
      if (!pinnedToBottomRef.current && isAtBottom()) {
        pinnedToBottomRef.current = true
      }
    }
    terminal.onScroll(maybeRepin)
    terminal.onLineFeed(maybeRepin)

    // Handle Shift+Enter for multiline input (sends same as Option+Enter)
    terminal.attachCustomKeyEventHandler((event) => {
      // Block both keydown AND keypress for Shift+Enter to prevent submit
      if (event.key === 'Enter' && event.shiftKey) {
        if (event.type === 'keydown' && onData) {
          onData('\x1b\r')
        }
        return false
      }
      return true
    })

    // Handle keyboard input - send to parent
    if (onData) {
      terminal.onData((data) => {
        onData(data)
        // Scroll to bottom and re-pin when user types
        pinnedToBottomRef.current = true
        terminal.scrollToBottom()
      })
    }

    // Focus terminal on mount
    terminal.focus()

    // Restore cursor visibility when terminal gains focus or is clicked
    // Claude Code may hide cursor during processing and not restore it
    // IMPORTANT: Preserve scroll position to prevent viewport jumping
    const showCursor = () => {
      if (isDisposedRef.current) return
      try {
        const buffer = terminal.buffer.active
        const viewportY = buffer.viewportY
        terminal.write('\x1b[?25h') // Show cursor escape sequence
        // Restore viewport if it changed (shouldn't, but defensive)
        if (buffer.viewportY !== viewportY) {
          terminal.scrollToLine(viewportY)
        }
      } catch {
        // Terminal may be disposed
      }
    }
    terminal.textarea?.addEventListener('focus', showCursor)
    containerRef.current.addEventListener('click', showCursor)

    // Refresh terminal when browser tab regains focus/visibility
    // This fixes blank terminal issues after tab switching or window focus loss
    const handleVisibilityChange = () => {
      if (isDisposedRef.current) return
      if (document.visibilityState === 'visible') {
        console.log('[XTerminal] Tab visible, refreshing terminal')
        try {
          terminal.refresh(0, terminal.rows - 1)
        } catch {
          // Terminal may be disposed
        }
      }
    }
    const handleWindowFocus = () => {
      if (isDisposedRef.current) return
      console.log('[XTerminal] Window focused, refreshing terminal')
      try {
        terminal.refresh(0, terminal.rows - 1)
      } catch {
        // Terminal may be disposed
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)

    // Notify parent that terminal is ready
    console.log('[XTerminal] Terminal created and mounted, calling onReady')
    if (onReady) {
      onReady()
    }

    // Capture container for cleanup
    const container = containerRef.current
    const textarea = terminal.textarea

    return () => {
      console.log('[XTerminal] Disposing terminal')
      // Set disposed flag FIRST to prevent async operations from running
      isDisposedRef.current = true
      // Note: Do NOT clear terminalRef/fitAddonRef here - React's useImperativeHandle
      // cleanup may still be referencing them. The disposed flag is sufficient protection.
      if (resizeTimeout) {
        clearTimeout(resizeTimeout)
      }
      resizeObserver.disconnect()
      container?.removeEventListener('wheel', handleWheel)
      container?.removeEventListener('click', showCursor)
      textarea?.removeEventListener('focus', showCursor)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
      terminal.dispose()
    }
  }, [onData, onResize, projectDir, onFileClick])

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    />
  )
})

XTerminal.displayName = 'XTerminal'

export default XTerminal
