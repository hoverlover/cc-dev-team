import { describe, it, expect } from 'vitest'
import { ScrollPinController } from '../../../dashboard/lib/scrollPinController.js'

describe('ScrollPinController', () => {
  describe('initial state', () => {
    it('starts pinned to bottom', () => {
      const ctrl = new ScrollPinController()
      expect(ctrl.pinned).toBe(true)
    })

    it('starts not writing', () => {
      const ctrl = new ScrollPinController()
      expect(ctrl.isWriting).toBe(false)
    })
  })

  describe('user scroll (wheel events)', () => {
    it('unpins when user scrolls away from bottom', () => {
      const ctrl = new ScrollPinController()
      ctrl.onUserScroll(false) // not at bottom
      expect(ctrl.pinned).toBe(false)
    })

    it('stays pinned when user scrolls but remains at bottom', () => {
      const ctrl = new ScrollPinController()
      ctrl.onUserScroll(true) // still at bottom
      expect(ctrl.pinned).toBe(true)
    })

    it('re-pins when user scrolls back to bottom', () => {
      const ctrl = new ScrollPinController()
      ctrl.onUserScroll(false) // scroll up
      expect(ctrl.pinned).toBe(false)
      ctrl.onUserScroll(true) // scroll back to bottom
      expect(ctrl.pinned).toBe(true)
    })
  })

  describe('auto events (onScroll/onLineFeed during output)', () => {
    it('re-pins when not writing and viewport reaches bottom', () => {
      const ctrl = new ScrollPinController()
      ctrl.onUserScroll(false) // user scrolled up
      expect(ctrl.pinned).toBe(false)

      // Terminal output fills up and viewport naturally reaches bottom
      // (not during a write operation)
      ctrl.onAutoEvent(true)
      expect(ctrl.pinned).toBe(true)
    })

    it('never unpins via auto events', () => {
      const ctrl = new ScrollPinController()
      expect(ctrl.pinned).toBe(true)
      ctrl.onAutoEvent(false) // auto event says not at bottom
      expect(ctrl.pinned).toBe(true) // should NOT unpin
    })

    it('does NOT re-pin during a write operation (the regression bug)', () => {
      const ctrl = new ScrollPinController()

      // User scrolls up - unpinned
      ctrl.onUserScroll(false)
      expect(ctrl.pinned).toBe(false)

      // A write begins
      ctrl.beginWrite()

      // During terminal.write(), xterm fires onScroll/onLineFeed synchronously.
      // xterm's internal buffer may temporarily show viewport at bottom,
      // causing isAtBottom() to return true. This must NOT re-pin.
      ctrl.onAutoEvent(true)
      expect(ctrl.pinned).toBe(false) // MUST stay unpinned!

      ctrl.endWrite()
      expect(ctrl.pinned).toBe(false) // still unpinned after write
    })

    it('suppresses multiple auto events during a single write', () => {
      const ctrl = new ScrollPinController()
      ctrl.onUserScroll(false) // user scrolled up

      ctrl.beginWrite()
      // Simulate multiple onLineFeed/onScroll events during a large write
      ctrl.onAutoEvent(true)
      ctrl.onAutoEvent(true)
      ctrl.onAutoEvent(false)
      ctrl.onAutoEvent(true)
      expect(ctrl.pinned).toBe(false) // all suppressed
      ctrl.endWrite()

      expect(ctrl.pinned).toBe(false)
    })
  })

  describe('user input', () => {
    it('re-pins on user keyboard input', () => {
      const ctrl = new ScrollPinController()
      ctrl.onUserScroll(false) // user scrolled up
      expect(ctrl.pinned).toBe(false)

      ctrl.onUserInput() // user types something
      expect(ctrl.pinned).toBe(true)
    })
  })

  describe('explicit pin', () => {
    it('pins when scrollToBottom is called explicitly', () => {
      const ctrl = new ScrollPinController()
      ctrl.onUserScroll(false) // user scrolled up
      expect(ctrl.pinned).toBe(false)

      ctrl.pin() // e.g., user clicks "scroll to bottom" button
      expect(ctrl.pinned).toBe(true)
    })
  })

  describe('full interaction sequence', () => {
    it('handles a realistic terminal session correctly', () => {
      const ctrl = new ScrollPinController()

      // 1. Initial state: pinned, output streams to bottom
      expect(ctrl.pinned).toBe(true)

      // 2. Writes arrive while pinned - should stay pinned
      ctrl.beginWrite()
      ctrl.onAutoEvent(true)
      ctrl.endWrite()
      expect(ctrl.pinned).toBe(true)

      // 3. User scrolls up to read earlier output
      ctrl.onUserScroll(false)
      expect(ctrl.pinned).toBe(false)

      // 4. More writes arrive - user stays scrolled up (THE REGRESSION)
      ctrl.beginWrite()
      ctrl.onAutoEvent(true) // xterm says "at bottom" during write
      ctrl.endWrite()
      expect(ctrl.pinned).toBe(false) // must NOT jump to bottom

      // 5. More writes arrive - user is still scrolled up
      ctrl.beginWrite()
      ctrl.onAutoEvent(true)
      ctrl.onAutoEvent(true)
      ctrl.endWrite()
      expect(ctrl.pinned).toBe(false) // still respects user position

      // 6. User scrolls back to bottom
      ctrl.onUserScroll(true)
      expect(ctrl.pinned).toBe(true) // re-pinned

      // 7. Writes arrive while pinned again
      ctrl.beginWrite()
      ctrl.onAutoEvent(true)
      ctrl.endWrite()
      expect(ctrl.pinned).toBe(true) // stays pinned
    })

    it('handles rapid scroll-up during streaming output', () => {
      const ctrl = new ScrollPinController()

      // Simulate: output is streaming, user tries to scroll up
      ctrl.beginWrite()
      ctrl.onAutoEvent(true)
      ctrl.endWrite()
      expect(ctrl.pinned).toBe(true)

      // User scrolls up between writes
      ctrl.onUserScroll(false)
      expect(ctrl.pinned).toBe(false)

      // Next write arrives immediately
      ctrl.beginWrite()
      ctrl.onAutoEvent(true) // suppressed
      ctrl.endWrite()
      expect(ctrl.pinned).toBe(false) // user's scroll-up is respected

      // Another write
      ctrl.beginWrite()
      ctrl.onAutoEvent(true) // suppressed
      ctrl.endWrite()
      expect(ctrl.pinned).toBe(false) // still unpinned

      // User scrolls back down to bottom
      ctrl.onUserScroll(true)
      expect(ctrl.pinned).toBe(true)
    })
  })
})
