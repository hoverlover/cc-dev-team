/**
 * Ring Buffer for accumulating PTY output
 *
 * Strips ANSI escape sequences and maintains a fixed-size buffer
 * of terminal output for pattern matching and state detection.
 */
export class RingBuffer {
  constructor(maxSize = 4096) {
    this.maxSize = maxSize
    this.buffer = ''
    this.lines = []
  }

  append(data) {
    // Strip ANSI escape sequences for pattern matching
    // This covers: CSI sequences, private modes, OSC sequences, and other escapes
    const cleaned = data
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')  // CSI sequences including private modes
      .replace(/\x1b\][^\x07]*\x07/g, '')       // OSC sequences (terminated by BEL)
      .replace(/\x1b\][^\x1b]*\x1b\\/g, '')     // OSC sequences (terminated by ST)
      .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, '') // DCS, SOS, PM, APC sequences
      .replace(/\x1b[\x20-\x2f]*[\x30-\x7e]/g, '') // Other escape sequences
    this.buffer += cleaned
    if (this.buffer.length > this.maxSize) {
      this.buffer = this.buffer.slice(-this.maxSize)
    }
    // Track line boundaries
    this.lines = this.buffer.split(/\r?\n/)
  }

  getRecentLines(n) {
    return this.lines.slice(-n)
  }

  getLastLine() {
    return this.lines[this.lines.length - 1] || ''
  }

  endsWithPrompt() {
    return /^[❯>]\s*$/.test(this.getLastLine())
  }

  clear() {
    this.buffer = ''
    this.lines = []
  }
}
