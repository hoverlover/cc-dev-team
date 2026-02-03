import { describe, it, expect, beforeEach, vi } from 'vitest'
import { InputTracker } from '../../../tools/lib/InputTracker.js'

describe('InputTracker', () => {
  let tracker

  beforeEach(() => {
    tracker = new InputTracker()
    vi.useFakeTimers()
  })

  describe('constructor', () => {
    it('initializes with empty buffer', () => {
      expect(tracker.buffer).toEqual([])
    })

    it('initializes with current timestamp for lastKeystroke', () => {
      const now = Date.now()
      expect(tracker.lastKeystroke).toBeCloseTo(now, -2)
    })

    it('initializes not in escape sequence', () => {
      expect(tracker.inEscSeq).toBe(false)
    })
  })

  describe('processByte - printable characters', () => {
    it('adds printable ASCII characters to buffer', () => {
      tracker.processByte(65) // 'A'
      tracker.processByte(66) // 'B'
      tracker.processByte(67) // 'C'
      expect(tracker.buffer).toEqual([65, 66, 67])
    })

    it('updates lastKeystroke on printable character', () => {
      const initialTime = tracker.lastKeystroke
      vi.advanceTimersByTime(100)
      tracker.processByte(65)
      expect(tracker.lastKeystroke).toBeGreaterThan(initialTime)
    })

    it('handles space character (32)', () => {
      tracker.processByte(72) // 'H'
      tracker.processByte(73) // 'I'
      tracker.processByte(32) // space
      expect(tracker.buffer).toEqual([72, 73, 32])
    })

    it('ignores non-printable control characters (< 32)', () => {
      tracker.processByte(1)  // SOH
      tracker.processByte(4)  // EOT
      expect(tracker.buffer).toEqual([])
    })

    it('ignores DEL character (127) as input (treated as backspace)', () => {
      tracker.processByte(65) // 'A'
      tracker.processByte(127) // DEL
      expect(tracker.buffer).toEqual([])
    })
  })

  describe('processByte - line editing', () => {
    it('clears buffer on Enter (13)', () => {
      tracker.processByte(65)
      tracker.processByte(66)
      tracker.processByte(13) // CR
      expect(tracker.buffer).toEqual([])
    })

    it('clears buffer on newline (10)', () => {
      tracker.processByte(65)
      tracker.processByte(66)
      tracker.processByte(10) // LF
      expect(tracker.buffer).toEqual([])
    })

    it('removes last character on backspace (127)', () => {
      tracker.processByte(65)
      tracker.processByte(66)
      tracker.processByte(67)
      tracker.processByte(127)
      expect(tracker.buffer).toEqual([65, 66])
    })

    it('removes last character on backspace (8)', () => {
      tracker.processByte(65)
      tracker.processByte(66)
      tracker.processByte(8) // BS
      expect(tracker.buffer).toEqual([65])
    })

    it('handles backspace on empty buffer gracefully', () => {
      tracker.processByte(127)
      expect(tracker.buffer).toEqual([])
    })

    it('clears buffer on Ctrl+U (21)', () => {
      tracker.processByte(65)
      tracker.processByte(66)
      tracker.processByte(21)
      expect(tracker.buffer).toEqual([])
    })

    it('clears buffer on Ctrl+C (3)', () => {
      tracker.processByte(65)
      tracker.processByte(66)
      tracker.processByte(3)
      expect(tracker.buffer).toEqual([])
    })

    it('deletes word on Ctrl+W (23)', () => {
      // "hello world" -> delete word -> "hello "
      'hello '.split('').forEach(c => tracker.processByte(c.charCodeAt(0)))
      'world'.split('').forEach(c => tracker.processByte(c.charCodeAt(0)))
      tracker.processByte(23) // Ctrl+W
      expect(tracker.buffer).toEqual([104, 101, 108, 108, 111, 32]) // "hello "
    })

    it('deletes to beginning if no space found on Ctrl+W', () => {
      'hello'.split('').forEach(c => tracker.processByte(c.charCodeAt(0)))
      tracker.processByte(23) // Ctrl+W
      expect(tracker.buffer).toEqual([])
    })
  })

  describe('processByte - escape sequences', () => {
    it('enters escape sequence mode on ESC (0x1b)', () => {
      tracker.processByte(0x1b)
      expect(tracker.inEscSeq).toBe(true)
    })

    it('records escape sequence start time', () => {
      const before = Date.now()
      tracker.processByte(0x1b)
      expect(tracker.escSeqStart).toBeGreaterThanOrEqual(before)
    })

    it('completes escape sequence on uppercase letter terminator', () => {
      tracker.processByte(0x1b) // ESC
      tracker.processByte(91)   // '['
      tracker.processByte(65)   // 'A' - arrow up
      expect(tracker.inEscSeq).toBe(false)
      expect(tracker.buffer).toEqual([]) // Escape sequence not added to buffer
    })

    it('completes escape sequence on lowercase letter terminator', () => {
      tracker.processByte(0x1b) // ESC
      tracker.processByte(91)   // '['
      tracker.processByte(109)  // 'm' - SGR terminator
      expect(tracker.inEscSeq).toBe(false)
    })

    it('completes escape sequence on tilde terminator (126)', () => {
      tracker.processByte(0x1b) // ESC
      tracker.processByte(91)   // '['
      tracker.processByte(51)   // '3'
      tracker.processByte(126)  // '~' - delete key sequence
      expect(tracker.inEscSeq).toBe(false)
    })

    it('skips intermediate escape sequence bytes', () => {
      tracker.processByte(0x1b) // ESC
      tracker.processByte(91)   // '[' - intermediate
      tracker.processByte(49)   // '1' - intermediate (number)
      tracker.processByte(59)   // ';' - intermediate (separator)
      tracker.processByte(50)   // '2' - intermediate (number)
      expect(tracker.inEscSeq).toBe(true)
      expect(tracker.buffer).toEqual([])
    })

    it('does not add escape sequence bytes to input buffer', () => {
      tracker.processByte(65) // 'A'
      tracker.processByte(0x1b)
      tracker.processByte(91)
      tracker.processByte(66) // 'B' - terminator, but in escape context
      tracker.processByte(67) // 'C' - regular character after escape ends
      expect(tracker.buffer).toEqual([65, 67])
    })

    // BUG FIX TEST: Escape sequence timeout
    it('times out escape sequence after 100ms and discards pending bytes', () => {
      tracker.processByte(0x1b) // Start escape sequence
      expect(tracker.inEscSeq).toBe(true)

      vi.advanceTimersByTime(150) // Wait > 100ms

      // Process a byte that would normally be an intermediate byte
      tracker.processByte(91) // '['

      // Should have timed out - no longer in escape sequence
      expect(tracker.inEscSeq).toBe(false)
      // The intermediate byte should NOT be added to buffer
      expect(tracker.buffer).toEqual([])
    })

    it('processes bytes normally after escape timeout', () => {
      tracker.processByte(0x1b) // Start escape sequence
      vi.advanceTimersByTime(150) // Timeout
      tracker.processByte(91) // '[' - discarded (timeout handling)

      // Now process regular characters
      tracker.processByte(65) // 'A'
      tracker.processByte(66) // 'B'
      expect(tracker.buffer).toEqual([65, 66])
    })

    // BUG FIX TEST: The original bug where timed-out escape bytes corrupted input
    it('does not corrupt input buffer when escape sequence times out mid-sequence', () => {
      // Type some text
      'hello'.split('').forEach(c => tracker.processByte(c.charCodeAt(0)))

      // Start an incomplete escape sequence (user pressed arrow key)
      tracker.processByte(0x1b)
      tracker.processByte(91) // '['
      // ... but no terminator arrives quickly enough

      vi.advanceTimersByTime(150) // Timeout

      // The first byte after timeout is discarded (as it triggers the timeout check)
      // This is intentional - the byte that reveals the timeout is considered
      // part of the stale escape sequence and is dropped
      tracker.processByte(32) // space - discarded as it triggers timeout detection
      tracker.processByte(119) // 'w' - processed normally
      tracker.processByte(111) // 'o' - processed normally

      // Buffer should contain "hellowo" - the space was discarded as part of
      // the escape sequence timeout cleanup
      const expected = 'hellowo'.split('').map(c => c.charCodeAt(0))
      expect(tracker.buffer).toEqual(expected)
    })
  })

  describe('canInject', () => {
    it('returns true when buffer is empty and idle timeout passed', () => {
      vi.advanceTimersByTime(3000) // Default is 2000ms
      expect(tracker.canInject()).toBe(true)
    })

    it('returns false when buffer has content', () => {
      tracker.processByte(65)
      vi.advanceTimersByTime(3000)
      expect(tracker.canInject()).toBe(false)
    })

    it('returns false when not enough time has passed since last keystroke', () => {
      vi.advanceTimersByTime(1000) // Less than 2000ms default
      expect(tracker.canInject()).toBe(false)
    })

    it('respects custom idle timeout parameter', () => {
      vi.advanceTimersByTime(500)
      expect(tracker.canInject(400)).toBe(true) // Custom 400ms timeout passed
      expect(tracker.canInject(600)).toBe(false) // Custom 600ms timeout not passed
    })

    it('returns false immediately after keystroke', () => {
      tracker.processByte(65)
      tracker.processByte(13) // Enter clears buffer
      // But lastKeystroke was just updated, so not enough idle time
      expect(tracker.canInject()).toBe(false)
    })

    it('returns true after buffer cleared and sufficient idle time', () => {
      tracker.processByte(65)
      tracker.processByte(13) // Clear buffer
      vi.advanceTimersByTime(3000) // Wait for idle
      expect(tracker.canInject()).toBe(true)
    })
  })
})
