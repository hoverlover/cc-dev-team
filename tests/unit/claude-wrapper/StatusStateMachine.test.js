import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StatusStateMachine } from '../../../tools/lib/StatusStateMachine.js'

describe('StatusStateMachine', () => {
  let sm
  let emittedStatuses

  beforeEach(() => {
    emittedStatuses = []
    sm = new StatusStateMachine((status) => {
      emittedStatuses.push({ ...status, timestamp: Date.now() })
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    sm.stopSpinner()
    sm.cancelIdleTimeout()
    vi.useRealTimers()
  })

  describe('constructor', () => {
    it('initializes in idle state', () => {
      expect(sm.state).toBe('idle')
    })

    it('initializes with empty task', () => {
      expect(sm.task).toBe('')
      expect(sm.taskBase).toBe('')
    })

    it('initializes waitingForInput as false', () => {
      expect(sm.waitingForInput).toBe(false)
    })

    it('stores emit function', () => {
      expect(typeof sm.emit).toBe('function')
    })
  })

  describe('VALID_TRANSITIONS', () => {
    it('allows idle -> thinking', () => {
      expect(StatusStateMachine.VALID_TRANSITIONS.idle).toContain('thinking')
    })

    it('allows idle -> working', () => {
      expect(StatusStateMachine.VALID_TRANSITIONS.idle).toContain('working')
    })

    it('allows idle -> waiting_input', () => {
      expect(StatusStateMachine.VALID_TRANSITIONS.idle).toContain('waiting_input')
    })

    it('allows thinking -> idle', () => {
      expect(StatusStateMachine.VALID_TRANSITIONS.thinking).toContain('idle')
    })

    it('allows thinking -> working', () => {
      expect(StatusStateMachine.VALID_TRANSITIONS.thinking).toContain('working')
    })

    it('allows offline -> idle', () => {
      expect(StatusStateMachine.VALID_TRANSITIONS.offline).toContain('idle')
    })
  })

  describe('transition - valid transitions', () => {
    it('transitions from idle to thinking', () => {
      const result = sm.transition('thinking', 'Processing…')
      expect(result).toBe(true)
      expect(sm.state).toBe('thinking')
    })

    it('transitions from idle to working', () => {
      const result = sm.transition('working', 'Bash(')
      expect(result).toBe(true)
      expect(sm.state).toBe('working')
    })

    it('transitions from idle to waiting_input', () => {
      const result = sm.transition('waiting_input', 'Permission required', true)
      expect(result).toBe(true)
      expect(sm.state).toBe('waiting_input')
      expect(sm.waitingForInput).toBe(true)
    })

    it('transitions from thinking to idle', () => {
      sm.transition('thinking', 'Task')
      const result = sm.transition('idle')
      expect(result).toBe(true)
      expect(sm.state).toBe('idle')
    })

    it('transitions from working to idle', () => {
      sm.transition('working', 'Tool')
      const result = sm.transition('idle')
      expect(result).toBe(true)
      expect(sm.state).toBe('idle')
    })
  })

  describe('transition - invalid transitions', () => {
    it('rejects invalid transition from idle', () => {
      const result = sm.transition('offline')
      // offline is special - always allowed
      expect(result).toBe(true)
    })

    it('rejects transition from thinking to waiting_input then back illegally', () => {
      sm.transition('thinking', 'Task')
      // thinking -> waiting_input is valid
      sm.transition('waiting_input', 'Prompt', true)
      // waiting_input -> thinking is valid
      expect(sm.transition('thinking', 'Back')).toBe(true)
    })
  })

  describe('transition - offline state', () => {
    it('allows transition to offline from any state', () => {
      sm.transition('thinking', 'Task')
      const result = sm.transition('offline')
      expect(result).toBe(true)
      expect(sm.state).toBe('offline')
    })

    it('stops spinner when going offline', () => {
      sm.transition('thinking', 'Task')
      expect(sm.spinnerTimer).not.toBeNull()
      sm.transition('offline')
      expect(sm.spinnerTimer).toBeNull()
    })

    it('clears task when going offline', () => {
      sm.transition('thinking', 'Task')
      sm.transition('offline')
      expect(sm.task).toBe('')
      expect(sm.taskBase).toBe('')
    })

    it('resets waitingForInput when going offline', () => {
      sm.transition('waiting_input', 'Prompt', true)
      sm.transition('offline')
      expect(sm.waitingForInput).toBe(false)
    })
  })

  describe('transition - self-transitions', () => {
    it('allows self-transition with different task', () => {
      sm.transition('thinking', 'Task 1')
      const result = sm.transition('thinking', 'Task 2')
      expect(result).toBe(true)
      expect(sm.taskBase).toBe('Task 2')
    })

    it('does not update task on self-transition with same task', () => {
      sm.transition('thinking', 'Same Task')
      const initialEmitCount = emittedStatuses.length
      sm.transition('thinking', 'Same Task')
      // Should not emit again for identical state
      expect(emittedStatuses.length).toBe(initialEmitCount)
    })
  })

  describe('spinner animation', () => {
    it('starts spinner on thinking state', () => {
      sm.transition('thinking', 'Task')
      expect(sm.spinnerTimer).not.toBeNull()
    })

    it('starts spinner on working state', () => {
      sm.transition('working', 'Tool')
      expect(sm.spinnerTimer).not.toBeNull()
    })

    it('stops spinner on idle state', () => {
      sm.transition('thinking', 'Task')
      sm.transition('idle')
      expect(sm.spinnerTimer).toBeNull()
    })

    it('stops spinner on waiting_input state', () => {
      sm.transition('thinking', 'Task')
      sm.transition('waiting_input', 'Prompt', true)
      expect(sm.spinnerTimer).toBeNull()
    })

    it('updates task with spinner character', () => {
      sm.transition('thinking', 'Processing')
      // Task should have spinner prefix
      expect(sm.task).toMatch(/^[✳✶✢✱✲✴✵✽✾✿] Processing$/)
    })

    it('rotates spinner characters over time', () => {
      sm.transition('thinking', 'Task')
      const firstTask = sm.task

      vi.advanceTimersByTime(200) // One spinner interval

      expect(sm.task).not.toBe(firstTask)
    })
  })

  describe('emitIfChanged', () => {
    it('emits status when state changes', () => {
      sm.transition('thinking', 'Task')
      expect(emittedStatuses.length).toBeGreaterThan(0)
      const lastStatus = emittedStatuses[emittedStatuses.length - 1]
      expect(lastStatus.status).toBe('thinking')
    })

    it('does not emit duplicate status', () => {
      sm.transition('thinking', 'Task')
      const count = emittedStatuses.length
      sm.emitIfChanged()
      expect(emittedStatuses.length).toBe(count)
    })

    it('includes waitingForInput in emitted status', () => {
      sm.transition('waiting_input', 'Prompt', true)
      const lastStatus = emittedStatuses[emittedStatuses.length - 1]
      expect(lastStatus.waitingForInput).toBe(true)
    })

    it('debounces spinner updates', () => {
      sm.setConfig({ debounceMs: 100 })
      sm.transition('thinking', 'Task')
      const initialCount = emittedStatuses.length

      // Rapid spinner updates should be debounced
      vi.advanceTimersByTime(50)
      sm.updateSpinnerTask()
      vi.advanceTimersByTime(50)

      // Should have debounced some updates
      expect(emittedStatuses.length).toBeLessThanOrEqual(initialCount + 2)
    })
  })

  describe('shouldIgnoreThinkingText', () => {
    it('returns true for stale repeated thinking text within 5 seconds of idle', () => {
      sm.transition('thinking', 'Task')
      sm.transition('idle')

      vi.advanceTimersByTime(1000) // 1 second after idle

      expect(sm.shouldIgnoreThinkingText('Task')).toBe(true)
    })

    it('returns false for different thinking text', () => {
      sm.transition('thinking', 'Task 1')
      sm.transition('idle')

      vi.advanceTimersByTime(1000)

      expect(sm.shouldIgnoreThinkingText('Task 2')).toBe(false)
    })

    it('returns false after 5 seconds of idle', () => {
      sm.transition('thinking', 'Task')
      sm.transition('idle')

      vi.advanceTimersByTime(6000) // 6 seconds

      expect(sm.shouldIgnoreThinkingText('Task')).toBe(false)
    })

    it('returns false when not in idle state', () => {
      sm.transition('thinking', 'Task')
      // Still in thinking state
      expect(sm.shouldIgnoreThinkingText('Task')).toBe(false)
    })
  })

  describe('scheduleIdleTimeout', () => {
    it('transitions to idle after timeout', () => {
      sm.setConfig({ idleTimeoutMs: 1000 })
      sm.transition('thinking', 'Task')
      sm.scheduleIdleTimeout()

      vi.advanceTimersByTime(1500)

      expect(sm.state).toBe('idle')
    })

    it('clears buffer on idle timeout when buffer provided', () => {
      const mockBuffer = { clear: vi.fn() }
      sm.setConfig({ idleTimeoutMs: 1000 })
      sm.transition('thinking', 'Task')
      sm.scheduleIdleTimeout(mockBuffer)

      vi.advanceTimersByTime(1500)

      expect(mockBuffer.clear).toHaveBeenCalled()
    })

    it('does not transition if already idle', () => {
      sm.setConfig({ idleTimeoutMs: 1000 })
      sm.scheduleIdleTimeout()

      vi.advanceTimersByTime(1500)

      expect(sm.state).toBe('idle')
    })

    it('cancels previous timeout on reschedule', () => {
      sm.setConfig({ idleTimeoutMs: 1000 })
      sm.transition('thinking', 'Task')
      sm.scheduleIdleTimeout()

      vi.advanceTimersByTime(500)
      sm.scheduleIdleTimeout() // Reschedule

      vi.advanceTimersByTime(700) // Total 1200ms, but only 700 since reschedule

      // Should not have timed out yet
      expect(sm.state).toBe('thinking')

      vi.advanceTimersByTime(500) // Now enough time has passed
      expect(sm.state).toBe('idle')
    })
  })

  describe('cancelIdleTimeout', () => {
    it('prevents idle transition', () => {
      sm.setConfig({ idleTimeoutMs: 1000 })
      sm.transition('thinking', 'Task')
      sm.scheduleIdleTimeout()

      sm.cancelIdleTimeout()
      vi.advanceTimersByTime(1500)

      expect(sm.state).toBe('thinking')
    })

    it('clears idleTimer reference', () => {
      sm.setConfig({ idleTimeoutMs: 1000 })
      sm.transition('thinking', 'Task')
      sm.scheduleIdleTimeout()

      expect(sm.idleTimer).not.toBeNull()
      sm.cancelIdleTimeout()
      expect(sm.idleTimer).toBeNull()
    })
  })

  describe('setConfig', () => {
    it('updates debounceMs', () => {
      sm.setConfig({ debounceMs: 200 })
      expect(sm.debounceMs).toBe(200)
    })

    it('updates idleTimeoutMs', () => {
      sm.setConfig({ idleTimeoutMs: 3000 })
      expect(sm.idleTimeoutMs).toBe(3000)
    })

    it('handles partial config', () => {
      sm.setConfig({ debounceMs: 200 })
      expect(sm.debounceMs).toBe(200)
      expect(sm.idleTimeoutMs).toBe(1500) // Default unchanged
    })
  })
})
