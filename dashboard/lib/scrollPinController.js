/**
 * Controls auto-scroll pinning behavior for terminal output.
 *
 * State machine rules:
 * - Starts pinned to bottom (auto-scroll enabled)
 * - User wheel/scroll events update pin state based on viewport position
 * - During writes, onScroll/onLineFeed events are suppressed to prevent
 *   false re-pinning from xterm's internal buffer state changes
 * - User keyboard input always re-pins
 * - Explicit scrollToBottom always re-pins
 */
export class ScrollPinController {
  constructor() {
    this._pinned = true
    this._writing = false
  }

  get pinned() {
    return this._pinned
  }

  /** Mark the start of a write operation. Suppresses auto-event re-pinning. */
  beginWrite() {
    this._writing = true
  }

  /** Mark the end of a write operation. */
  endWrite() {
    this._writing = false
  }

  /** Whether a write is currently in progress. */
  get isWriting() {
    return this._writing
  }

  /**
   * Called on user-initiated scroll (wheel events).
   * Can both pin and unpin based on viewport position.
   */
  onUserScroll(isAtBottom) {
    this._pinned = isAtBottom
  }

  /**
   * Called on terminal auto-events (onScroll, onLineFeed).
   * Can only RE-PIN (never unpin). Suppressed during writes.
   */
  onAutoEvent(isAtBottom) {
    if (this._writing) return
    if (!this._pinned && isAtBottom) {
      this._pinned = true
    }
  }

  /** Called on user keyboard input. Always re-pins. */
  onUserInput() {
    this._pinned = true
  }

  /** Explicitly pin to bottom (e.g., scrollToBottom button). */
  pin() {
    this._pinned = true
  }
}
