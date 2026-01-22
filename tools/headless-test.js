#!/usr/bin/env node
/**
 * Test script to verify Claude Code works in a PTY with output relay.
 *
 * This simulates the headless dashboard scenario:
 * - Claude Code runs in a PTY with fixed size
 * - Raw output goes to stdout (simulating xterm.js at same size)
 * - Input comes from a separate readline interface
 * - All I/O is logged to a file for analysis
 *
 * Run with: node tools/headless-test.js
 */

import pty from '@lydell/node-pty-darwin-arm64'
import { execSync } from 'child_process'
import { createWriteStream } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Fixed terminal size - MUST match what xterm.js would use
const COLS = 120
const ROWS = 40

// Log file for analysis
const logFile = createWriteStream(join(__dirname, '..', 'logs', 'headless-test.log'))
function log(msg) {
  const timestamp = new Date().toISOString()
  logFile.write(`${timestamp} ${msg}\n`)
}

// Find Claude executable
let claudePath
try {
  claudePath = execSync('which claude', { encoding: 'utf8' }).trim()
} catch {
  claudePath = '/Users/cboyd/.local/bin/claude'
}

log(`Starting headless test`)
log(`Claude path: ${claudePath}`)
log(`PTY size: ${COLS}x${ROWS}`)

// Create PTY with fixed size
const ptyProcess = pty.spawn(claudePath, [], {
  name: 'xterm-256color',
  cols: COLS,
  rows: ROWS,
  cwd: process.cwd(),
  env: {
    ...process.env,
    TERM: 'xterm-256color'
  }
})

// Write raw PTY output directly to stdout
// This is exactly what xterm.js would receive
ptyProcess.onData((data) => {
  process.stdout.write(data)
  // Log raw bytes (escaped) for analysis
  log(`[OUT ${data.length}b] ${JSON.stringify(data).slice(0, 200)}...`)
})

// Handle PTY exit
ptyProcess.onExit(({ exitCode, signal }) => {
  log(`Claude exited: code=${exitCode}, signal=${signal}`)
  console.log('\n\n[TEST] Claude Code exited')
  process.exit(exitCode)
})

// Read input from stdin in raw mode
// This simulates dashboard sending keystrokes
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
}
process.stdin.resume()
process.stdin.on('data', (data) => {
  // Ctrl+] (0x1D) = exit the test script
  if (data[0] === 0x1D) {
    console.log('\n\n[TEST] Ctrl+] pressed - exiting test...')
    log('User pressed Ctrl+] to exit')
    ptyProcess.kill()
    process.exit(0)
  }
  // Log what we're sending
  log(`[IN ${data.length}b] ${JSON.stringify(data.toString())}`)
  // Forward to PTY
  ptyProcess.write(data)
})

// Handle exit
process.on('SIGINT', () => {
  log('Caught SIGINT')
  ptyProcess.write('\x03')
})

process.on('exit', () => {
  logFile.end()
})

// Resize our terminal to match PTY size for proper rendering
process.stdout.write(`\x1b[8;${ROWS};${COLS}t`)
