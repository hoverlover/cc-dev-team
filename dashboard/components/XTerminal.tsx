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
  // Track whether auto-scroll is enabled (disabled when user scrolls up)
  const autoScrollRef = useRef(true)

  useImperativeHandle(actualRef, () => ({
    write: (data: string) => {
      if (terminalRef.current) {
        terminalRef.current.write(data)
        // Only auto-scroll if user hasn't scrolled up
        if (autoScrollRef.current) {
          terminalRef.current.scrollToBottom()
        }
      }
    },
    clear: () => {
      terminalRef.current?.clear()
    },
    focus: () => {
      terminalRef.current?.focus()
      if (autoScrollRef.current) {
        terminalRef.current?.scrollToBottom()
      }
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
      autoScrollRef.current = true
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

    // Handle scroll events to manage auto-scroll behavior
    // Disable auto-scroll when user scrolls up, re-enable when they scroll to bottom
    terminal.onScroll(() => {
      const buffer = terminal.buffer.active
      const viewportY = buffer.viewportY
      const baseY = buffer.baseY

      // Check if we're at the bottom (viewportY equals baseY means we're at the bottom)
      const isAtBottom = viewportY >= baseY

      if (isAtBottom) {
        // User scrolled back to bottom, re-enable auto-scroll
        autoScrollRef.current = true
      } else {
        // User scrolled up, disable auto-scroll
        autoScrollRef.current = false
      }
    })

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
        // Scroll to bottom when user types (and re-enable auto-scroll)
        autoScrollRef.current = true
        terminal.scrollToBottom()
      })
    }

    // Focus terminal on mount
    terminal.focus()

    // Notify parent that terminal is ready
    if (onReady) {
      onReady()
    }

    return () => {
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
