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
  constructor() {
    this.buffer = []
    this.lastKeystroke = Date.now()
    this.inEscSeq = false
    this.escSeqStart = 0
  }

  processByte(b) {
    if (b === 0x1b) {
      this.inEscSeq = true
      this.escSeqStart = Date.now()
      return
    }

    if (this.inEscSeq) {
      if (Date.now() - this.escSeqStart > 100) {
        // Escape sequence timed out - discard and don't process as normal input
        this.inEscSeq = false
        return
      } else if ((b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 126) {
        // Valid escape sequence terminator - complete and discard
        this.inEscSeq = false
        return
      } else {
        // Intermediate escape sequence byte - skip
        return
      }
    }

    this.lastKeystroke = Date.now()

    if (b === 13 || b === 10) {
      // Enter/newline - clear buffer
      this.buffer = []
    } else if (b === 127 || b === 8) {
      // Backspace/delete - remove last char
      this.buffer.pop()
    } else if (b === 21) {
      // Ctrl+U - clear line
      this.buffer = []
    } else if (b === 3) {
      // Ctrl+C - clear buffer
      this.buffer = []
    } else if (b === 23) {
      // Ctrl+W - delete word
      while (this.buffer.length > 0 && this.buffer[this.buffer.length - 1] !== 32) {
        this.buffer.pop()
      }
    } else if (b >= 32 && b < 127) {
      // Printable ASCII - add to buffer
      this.buffer.push(b)
    }
  }

  canInject(idleTimeoutMs = 2000) {
    return this.buffer.length === 0 && (Date.now() - this.lastKeystroke) > idleTimeoutMs
  }
}
