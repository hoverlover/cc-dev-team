'use client'

import React, { useEffect, useRef, useImperativeHandle, forwardRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { WebLinksAddon } from '@xterm/addon-web-links'
// Note: xterm.css is imported in page.tsx to avoid CSS chunk loading issues with dynamic imports

// Fixed terminal size to match headless mode
const FIXED_COLS = 120
const FIXED_ROWS = 40

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
  forwardedRef?: React.Ref<XTerminalHandle> // For dynamic import compatibility
}

const XTerminal = forwardRef<XTerminalHandle, XTerminalProps>(({ className, onData, onReady, forwardedRef }, ref) => {
  // Use forwardedRef if provided (from dynamic import wrapper), otherwise use ref
  const actualRef = forwardedRef || ref
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const [isReady, setIsReady] = useState(false)
  // Track whether we're pinned to bottom (starts pinned)
  const pinnedToBottomRef = useRef(true)

  useImperativeHandle(actualRef, () => ({
    write: (data: string) => {
      console.log('[XTerminal] write called', { dataLen: data.length, hasTerminal: !!terminalRef.current })
      if (terminalRef.current) {
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
      }
    },
    clear: () => {
      terminalRef.current?.clear()
    },
    focus: () => {
      terminalRef.current?.focus()
      // Don't force scroll on focus - respect user's pinned state
    },
    getBuffer: () => {
      if (!terminalRef.current) return ''
      const buffer = terminalRef.current.buffer.active
      const lines: string[] = []
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i)
        if (line) {
          lines.push(line.translateToString())
        }
      }
      return lines.join('\n')
    },
    scrollToBottom: () => {
      pinnedToBottomRef.current = true
      terminalRef.current?.scrollToBottom()
    },
  }), [isReady])

  useEffect(() => {
    if (!containerRef.current) return

    // Create terminal with FIXED size to match headless PTY
    const terminal = new Terminal({
      cols: FIXED_COLS,
      rows: FIXED_ROWS,
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
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        // Make cursor invisible - Claude Code renders its own
        cursor: 'transparent',
        cursorAccent: 'transparent',
        selectionBackground: '#3d5a80',
        black: '#1a1a2e',
        red: '#ff6b6b',
        green: '#a8e6cf',
        yellow: '#ffd93d',
        blue: '#6bcbff',
        magenta: '#c792ea',
        cyan: '#89ddff',
        white: '#e0e0e0',
        brightBlack: '#4a4a6a',
        brightRed: '#ff8a8a',
        brightGreen: '#b8f6df',
        brightYellow: '#ffe66d',
        brightBlue: '#8bdbff',
        brightMagenta: '#d7a2fa',
        brightCyan: '#99edff',
        brightWhite: '#ffffff',
      },
    })

    // Add web links addon for clickable URLs
    const webLinksAddon = new WebLinksAddon()
    terminal.loadAddon(webLinksAddon)

    // Open terminal in container
    terminal.open(containerRef.current)
    terminalRef.current = terminal
    setIsReady(true)

    // Check if at bottom - used to determine if we should auto-scroll
    const isAtBottom = () => {
      const buffer = terminal.buffer.active
      const distanceFromBottom = buffer.baseY - buffer.viewportY
      return distanceFromBottom <= 1
    }

    // IMPORTANT: xterm's onScroll does NOT fire on user scroll (known bug)
    // We must listen to wheel events on the container directly
    // See: https://github.com/xtermjs/xterm.js/issues/3864
    // ONLY user wheel events can unpin (set to false) - this prevents
    // automatic scroll events during large writes from incorrectly unpinning
    const handleWheel = () => {
      requestAnimationFrame(() => {
        pinnedToBottomRef.current = isAtBottom()
      })
    }
    containerRef.current.addEventListener('wheel', handleWheel)

    // onScroll/onLineFeed fire during writes - these should only RE-PIN
    // if we've reached the bottom, never unpin (that's only for user scroll)
    const maybeRepin = () => {
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
      const buffer = terminal.buffer.active
      const viewportY = buffer.viewportY
      terminal.write('\x1b[?25h') // Show cursor escape sequence
      // Restore viewport if it changed (shouldn't, but defensive)
      if (buffer.viewportY !== viewportY) {
        terminal.scrollToLine(viewportY)
      }
    }
    terminal.textarea?.addEventListener('focus', showCursor)
    containerRef.current.addEventListener('click', showCursor)

    // Refresh terminal when browser tab regains focus/visibility
    // This fixes blank terminal issues after tab switching or window focus loss
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[XTerminal] Tab visible, refreshing terminal')
        terminal.refresh(0, terminal.rows - 1)
      }
    }
    const handleWindowFocus = () => {
      console.log('[XTerminal] Window focused, refreshing terminal')
      terminal.refresh(0, terminal.rows - 1)
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
      container?.removeEventListener('wheel', handleWheel)
      container?.removeEventListener('click', showCursor)
      textarea?.removeEventListener('focus', showCursor)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
      terminal.dispose()
    }
  }, [onData])

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
