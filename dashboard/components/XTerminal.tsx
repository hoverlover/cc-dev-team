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

  useImperativeHandle(actualRef, () => ({
    write: (data: string) => {
      if (terminalRef.current) {
        terminalRef.current.write(data)
      }
    },
    clear: () => {
      terminalRef.current?.clear()
    },
    focus: () => {
      terminalRef.current?.focus()
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
  }), [isReady])

  useEffect(() => {
    if (!containerRef.current) return

    // Create terminal with FIXED size to match headless PTY
    const terminal = new Terminal({
      cols: FIXED_COLS,
      rows: FIXED_ROWS,
      cursorBlink: true,
      cursorStyle: 'block',
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
        cursor: '#a8e6cf',
        cursorAccent: '#1a1a2e',
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

    // Handle keyboard input - send to parent
    if (onData) {
      terminal.onData((data) => {
        onData(data)
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
