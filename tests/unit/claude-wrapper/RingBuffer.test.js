import { describe, it, expect, beforeEach } from 'vitest'
import { RingBuffer } from '../../../tools/lib/RingBuffer.js'

describe('RingBuffer', () => {
  let buffer

  beforeEach(() => {
    buffer = new RingBuffer(100) // Small size for testing
  })

  describe('constructor', () => {
    it('initializes with specified maxSize', () => {
      expect(buffer.maxSize).toBe(100)
    })

    it('initializes with empty buffer', () => {
      expect(buffer.buffer).toBe('')
    })

    it('initializes with empty lines array', () => {
      expect(buffer.lines).toEqual([])
    })

    it('uses default maxSize of 4096 when not specified', () => {
      const defaultBuffer = new RingBuffer()
      expect(defaultBuffer.maxSize).toBe(4096)
    })
  })

  describe('append - basic functionality', () => {
    it('appends plain text to buffer', () => {
      buffer.append('hello')
      expect(buffer.buffer).toBe('hello')
    })

    it('accumulates multiple appends', () => {
      buffer.append('hello')
      buffer.append(' world')
      expect(buffer.buffer).toBe('hello world')
    })

    it('tracks line boundaries with LF', () => {
      buffer.append('line1\nline2\nline3')
      expect(buffer.lines).toEqual(['line1', 'line2', 'line3'])
    })

    it('tracks line boundaries with CRLF', () => {
      buffer.append('line1\r\nline2\r\nline3')
      expect(buffer.lines).toEqual(['line1', 'line2', 'line3'])
    })

    it('handles mixed line endings', () => {
      buffer.append('line1\nline2\r\nline3\n')
      expect(buffer.lines).toEqual(['line1', 'line2', 'line3', ''])
    })
  })

  describe('append - buffer overflow', () => {
    it('truncates from beginning when exceeding maxSize', () => {
      const smallBuffer = new RingBuffer(10)
      smallBuffer.append('12345678901234567890') // 20 chars
      expect(smallBuffer.buffer.length).toBe(10)
      expect(smallBuffer.buffer).toBe('1234567890')
    })

    it('keeps most recent content when truncating', () => {
      const smallBuffer = new RingBuffer(5)
      smallBuffer.append('abcde')
      smallBuffer.append('fghij')
      expect(smallBuffer.buffer).toBe('fghij')
    })
  })

  describe('append - ANSI escape sequence stripping', () => {
    it('strips CSI sequences (cursor movement, colors)', () => {
      buffer.append('\x1b[32mgreen\x1b[0m')
      expect(buffer.buffer).toBe('green')
    })

    it('strips CSI sequences with private mode marker (?)', () => {
      buffer.append('\x1b[?25l') // Hide cursor
      buffer.append('text')
      buffer.append('\x1b[?25h') // Show cursor
      expect(buffer.buffer).toBe('text')
    })

    it('strips CSI sequences with multiple parameters', () => {
      buffer.append('\x1b[1;31;40mtext\x1b[0m')
      expect(buffer.buffer).toBe('text')
    })

    it('strips OSC sequences terminated by BEL', () => {
      buffer.append('\x1b]0;Window Title\x07text')
      expect(buffer.buffer).toBe('text')
    })

    it('strips OSC sequences terminated by ST', () => {
      buffer.append('\x1b]0;Title\x1b\\text')
      expect(buffer.buffer).toBe('text')
    })

    it('strips DCS sequences', () => {
      buffer.append('\x1bPsequence\x1b\\text')
      expect(buffer.buffer).toBe('text')
    })

    it('strips other escape sequences (2-byte)', () => {
      buffer.append('\x1b=') // Application keypad mode
      buffer.append('text')
      expect(buffer.buffer).toBe('text')
    })

    it('handles mixed escape sequences and text', () => {
      buffer.append('\x1b[32m✓\x1b[0m Done in \x1b[1m1.5s\x1b[0m')
      expect(buffer.buffer).toBe('✓ Done in 1.5s')
    })

    it('preserves unicode characters while stripping escapes', () => {
      buffer.append('\x1b[33m✳ Thinking…\x1b[0m')
      expect(buffer.buffer).toBe('✳ Thinking…')
    })
  })

  describe('getRecentLines', () => {
    beforeEach(() => {
      buffer.append('line1\nline2\nline3\nline4\nline5')
    })

    it('returns last n lines', () => {
      expect(buffer.getRecentLines(2)).toEqual(['line4', 'line5'])
    })

    it('returns all lines if n exceeds total lines', () => {
      expect(buffer.getRecentLines(10)).toEqual(['line1', 'line2', 'line3', 'line4', 'line5'])
    })

    it('returns all lines for n=0 (slice behavior)', () => {
      // Note: slice(-0) returns all elements, this is expected JS behavior
      expect(buffer.getRecentLines(0)).toEqual(['line1', 'line2', 'line3', 'line4', 'line5'])
    })

    it('returns single line for n=1', () => {
      expect(buffer.getRecentLines(1)).toEqual(['line5'])
    })
  })

  describe('getLastLine', () => {
    it('returns the last line', () => {
      buffer.append('line1\nline2\nline3')
      expect(buffer.getLastLine()).toBe('line3')
    })

    it('returns empty string for empty buffer', () => {
      expect(buffer.getLastLine()).toBe('')
    })

    it('returns content after last newline', () => {
      buffer.append('complete\npartial')
      expect(buffer.getLastLine()).toBe('partial')
    })

    it('returns empty string when buffer ends with newline', () => {
      buffer.append('line1\nline2\n')
      expect(buffer.getLastLine()).toBe('')
    })
  })

  describe('endsWithPrompt', () => {
    it('returns true for ❯ prompt', () => {
      buffer.append('some output\n❯ ')
      expect(buffer.endsWithPrompt()).toBe(true)
    })

    it('returns true for > prompt', () => {
      buffer.append('some output\n> ')
      expect(buffer.endsWithPrompt()).toBe(true)
    })

    it('returns true for ❯ with trailing spaces', () => {
      buffer.append('output\n❯   ')
      expect(buffer.endsWithPrompt()).toBe(true)
    })

    it('returns true for prompt at start of buffer', () => {
      buffer.append('❯ ')
      expect(buffer.endsWithPrompt()).toBe(true)
    })

    it('returns false when prompt has text after it', () => {
      buffer.append('❯ hello')
      expect(buffer.endsWithPrompt()).toBe(false)
    })

    it('returns false for other content', () => {
      buffer.append('Thinking…')
      expect(buffer.endsWithPrompt()).toBe(false)
    })

    it('returns false for empty buffer', () => {
      expect(buffer.endsWithPrompt()).toBe(false)
    })
  })

  describe('clear', () => {
    it('clears the buffer', () => {
      buffer.append('some content')
      buffer.clear()
      expect(buffer.buffer).toBe('')
    })

    it('clears the lines array', () => {
      buffer.append('line1\nline2')
      buffer.clear()
      expect(buffer.lines).toEqual([])
    })

    it('allows new content after clear', () => {
      buffer.append('old')
      buffer.clear()
      buffer.append('new')
      expect(buffer.buffer).toBe('new')
    })
  })
})
