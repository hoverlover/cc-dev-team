/**
 * Input Tracker for message injection timing
 *
 * Tracks keyboard input to determine when it's safe to inject
 * team messages into the terminal without interrupting user input.
 *
 * Handles escape sequences, backspace, line editing, and other
 * terminal control characters.
 */
export class InputTracker {
  constructor({ debug } = {}) {
    this.buffer = []
    this.lastKeystroke = Date.now()
    this.inEscSeq = false
    this.escSeqStart = 0
    this.debug = typeof debug === 'function' ? debug : null
  }

  processByte(b) {
    const beforeLen = this.buffer.length
    const logEvent = (event) => {
      if (!this.debug) return
      const byteHex = `0x${b.toString(16).padStart(2, '0')}`
      const bufferInfo = this.getBufferDebug()
      this.debug(`${event} byte=${byteHex} len=${beforeLen}->${this.buffer.length} ${bufferInfo}`)
    }

    if (b === 0x1b) {
      this.inEscSeq = true
      this.escSeqStart = Date.now()
      logEvent('esc_start')
      return
    }

    if (this.inEscSeq) {
      if (Date.now() - this.escSeqStart > 100) {
        // Escape sequence timed out - discard and don't process as normal input
        this.inEscSeq = false
        logEvent('esc_timeout')
        return
      } else if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 126) {
        // Valid escape sequence terminator - complete and discard
        this.inEscSeq = false
        logEvent('esc_end')
        return
      } else {
        // Intermediate escape sequence byte - skip
        logEvent('esc_mid')
        return
      }
    }

    this.lastKeystroke = Date.now()

    if (b === 13 || b === 10) {
      // Enter/newline - clear buffer
      this.buffer = []
      logEvent('enter')
    } else if (b === 127 || b === 8) {
      // Backspace/delete - remove last char
      if (this.buffer.length > 0) {
        this.buffer.pop()
      }
      logEvent('backspace')
    } else if (b === 21) {
      // Ctrl+U - clear line
      this.buffer = []
      logEvent('ctrl_u')
    } else if (b === 3) {
      // Ctrl+C - clear buffer
      this.buffer = []
      logEvent('ctrl_c')
    } else if (b === 23) {
      // Ctrl+W - delete word
      while (this.buffer.length > 0 && this.buffer[this.buffer.length - 1] !== 32) {
        this.buffer.pop()
      }
      logEvent('ctrl_w')
    } else if (b >= 32 && b < 127) {
      // Printable ASCII - add to buffer
      this.buffer.push(b)
      logEvent(`printable:${String.fromCharCode(b)}`)
    } else {
      logEvent('ignored')
    }
  }

  canInject(idleTimeoutMs = 2000) {
    return this.buffer.length === 0 && (Date.now() - this.lastKeystroke) > idleTimeoutMs
  }

  getBufferDebug() {
    if (this.buffer.length === 0) return 'buffer=[]'
    const text = this.buffer.map((byte) => {
      if (byte >= 32 && byte < 127) {
        return String.fromCharCode(byte)
      }
      return `\\x${byte.toString(16).padStart(2, '0')}`
    }).join('')
    const hex = this.buffer.map(byte => byte.toString(16).padStart(2, '0')).join(' ')
    return `buffer="${text}" hex=[${hex}]`
  }
}
