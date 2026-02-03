/**
 * State Machine for tracking agent status
 *
 * Tracks the current state of a Claude Code agent based on terminal output.
 * States: idle, thinking, working, waiting_input, offline
 *
 * Includes spinner animation for thinking/working states.
 */

// Spinner characters for animation (matching Claude Code style)
const SPINNER_CHARS = ['✳', '✶', '✢', '✱', '✲', '✴', '✵', '✽', '✾', '✿']
const SPINNER_INTERVAL_MS = 200

export class StatusStateMachine {
  // Valid state transitions
  // Note: Claude can jump between states quickly, so we allow flexible transitions
  static VALID_TRANSITIONS = {
    idle: ['thinking', 'working', 'waiting_input'],  // Can start with any activity
    thinking: ['working', 'waiting_input', 'idle'],
    working: ['thinking', 'waiting_input', 'idle'],  // Tool can trigger input prompt
    waiting_input: ['thinking', 'working', 'idle'],  // Input can lead to any state
    offline: ['idle', 'thinking', 'working']  // Can recover from offline
  }

  constructor(emitFn) {
    this.state = 'idle'
    this.task = ''
    this.taskBase = '' // Task text without spinner prefix
    this.waitingForInput = false
    this.stateEnteredAt = Date.now()
    this.lastEmitAt = 0
    this.lastEmittedState = null
    this.emit = emitFn
    this.idleTimer = null
    this.spinnerTimer = null
    this.spinnerIndex = 0
    // Track last thinking text to prevent re-triggering on stale content
    this.lastThinkingText = ''
    this.lastThinkingSeenAt = 0
    this.idleTransitionAt = 0  // When we last went idle
    this.lastInputReceivedAt = 0  // When we last received input (for debouncing permission prompts)
    // Configuration - can be overridden via setConfig
    this.debounceMs = 100
    this.idleTimeoutMs = 1500
  }

  setConfig({ debounceMs, idleTimeoutMs } = {}) {
    if (debounceMs !== undefined) this.debounceMs = debounceMs
    if (idleTimeoutMs !== undefined) this.idleTimeoutMs = idleTimeoutMs
  }

  transition(newState, task = '', waitingForInput = false) {
    // Always allow transition to offline
    if (newState === 'offline') {
      this.stopSpinner()
      this.state = 'offline'
      this.task = ''
      this.taskBase = ''
      this.waitingForInput = false
      this.stateEnteredAt = Date.now()
      this.emitIfChanged()
      return true
    }

    // Allow self-transitions (updating task while in same state)
    if (newState === this.state) {
      // Only update if task base changed
      if (task !== this.taskBase) {
        if (newState === 'thinking' || newState === 'working') {
          this.startSpinner(task)
        } else {
          // Stop spinner when in non-spinner state (idle, waiting_input)
          this.stopSpinner()
          this.task = task
          this.taskBase = task
          this.emitIfChanged()
        }
      }
      return true
    }

    // Validate transition is legal
    const validTargets = StatusStateMachine.VALID_TRANSITIONS[this.state]
    if (!validTargets?.includes(newState)) {
      return false
    }

    this.state = newState
    this.waitingForInput = waitingForInput
    this.stateEnteredAt = Date.now()

    // Start/stop spinner based on state
    if (newState === 'thinking' || newState === 'working') {
      this.lastThinkingText = task
      this.lastThinkingSeenAt = Date.now()
      this.startSpinner(task)
    } else {
      // Track when we go idle
      if (newState === 'idle') {
        this.idleTransitionAt = Date.now()
      }
      this.stopSpinner()
      this.task = task
      this.taskBase = task
      this.emitIfChanged()
    }

    return true
  }

  // Check if thinking text should be ignored (stale repeated content)
  shouldIgnoreThinkingText(text) {
    const now = Date.now()
    const timeSinceIdle = now - this.idleTransitionAt
    const isSameText = text === this.lastThinkingText

    // If we went idle recently (within 5 seconds) and see the same thinking text,
    // it's probably stale terminal content being re-rendered
    if (this.state === 'idle' && isSameText && timeSinceIdle < 5000) {
      return true
    }
    return false
  }

  emitIfChanged() {
    const now = Date.now()

    // Build status object
    const statusObj = {
      status: this.state,
      task: this.task,
      waitingForInput: this.waitingForInput
    }

    // Only emit if something actually changed
    const stateKey = `${this.state}:${this.task}:${this.waitingForInput}`
    if (stateKey === this.lastEmittedState) {
      return
    }

    // Check if this is a STATE change (not just task/spinner update)
    const lastState = this.lastEmittedState?.split(':')[0]
    const isStateChange = lastState !== this.state

    // Debounce spinner updates (same state, different task), but ALWAYS emit state changes
    if (!isStateChange && now - this.lastEmitAt < this.debounceMs) {
      return
    }

    this.lastEmitAt = now
    this.lastEmittedState = stateKey
    this.emit(statusObj)
  }

  scheduleIdleTimeout(buffer) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
    }

    this.idleTimer = setTimeout(() => {
      // If we're in thinking or working state for too long without updates,
      // transition to idle (completion may have been missed)
      if (this.state === 'thinking' || this.state === 'working') {
        this.transition('idle')
        // Clear buffer to prevent old thinking text from retriggering
        if (buffer) buffer.clear()
      }
    }, this.idleTimeoutMs)
  }

  cancelIdleTimeout() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  startSpinner(taskBase) {
    this.taskBase = taskBase
    this.spinnerIndex = 0
    this.updateSpinnerTask()

    // Clear any existing spinner timer
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer)
    }

    // Start spinner animation
    this.spinnerTimer = setInterval(() => {
      this.spinnerIndex = (this.spinnerIndex + 1) % SPINNER_CHARS.length
      this.updateSpinnerTask()
    }, SPINNER_INTERVAL_MS)
  }

  updateSpinnerTask() {
    const spinner = SPINNER_CHARS[this.spinnerIndex]
    this.task = `${spinner} ${this.taskBase}`
    this.emitIfChanged()
  }

  stopSpinner() {
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer)
      this.spinnerTimer = null
    }
  }
}
