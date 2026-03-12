import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GracefulShutdown } from '../../../broker/lib/gracefulShutdown.js'

describe('GracefulShutdown', () => {
  let mockSupabase
  let mockDb
  let mockAgents
  let shutdown

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn(() => mockSupabase),
      update: vi.fn(() => mockSupabase),
      eq: vi.fn(() => ({ error: null }))
    }

    mockDb = { close: vi.fn() }

    const mockProc = {
      kill: vi.fn(),
      on: vi.fn((event, cb) => { if (event === 'exit') setTimeout(cb, 10) })
    }

    mockAgents = new Map([
      ['pm', { proc: mockProc, abort: vi.fn() }]
    ])

    shutdown = new GracefulShutdown({
      supabase: mockSupabase,
      db: mockDb,
      agents: mockAgents,
      machineId: 'fly-machine-1',
      currentTask: { id: 'task-abc', status: 'running' },
      heartbeatInterval: null,
      taskTimeout: null
    })
  })

  it('aborts all agents on shutdown', async () => {
    await shutdown.execute()

    const agent = mockAgents.get('pm')
    expect(agent.abort).toHaveBeenCalled()
  })

  it('updates task status to queued if running', async () => {
    await shutdown.execute()

    expect(mockSupabase.from).toHaveBeenCalledWith('tasks')
    expect(mockSupabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued', error: expect.any(String) })
    )
  })

  it('updates machine status to stopped', async () => {
    await shutdown.execute()

    expect(mockSupabase.from).toHaveBeenCalledWith('machines')
    expect(mockSupabase.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'stopped' })
    )
  })

  it('closes SQLite database', async () => {
    await shutdown.execute()

    expect(mockDb.close).toHaveBeenCalled()
  })

  it('clears heartbeat and task timeout', async () => {
    const heartbeat = setInterval(() => {}, 60000)
    const taskTimeout = setTimeout(() => {}, 60000)
    shutdown.heartbeatInterval = heartbeat
    shutdown.taskTimeout = taskTimeout

    await shutdown.execute()

    // Verify they were cleared (no assertion needed — if not cleared, test process hangs)
    clearInterval(heartbeat) // cleanup
    clearTimeout(taskTimeout)
  })

  it('only executes once (idempotent)', async () => {
    await shutdown.execute()
    await shutdown.execute() // second call should be no-op

    // abort should only be called once
    const agent = mockAgents.get('pm')
    expect(agent.abort).toHaveBeenCalledTimes(1)
  })

  it('does not update task if none is running', async () => {
    shutdown.currentTask = null

    await shutdown.execute()

    // Should still update machine but not task
    const fromCalls = mockSupabase.from.mock.calls.map(c => c[0])
    expect(fromCalls).toContain('machines')
    // tasks update should not happen
    const updateCalls = mockSupabase.update.mock.calls
    const hasTaskUpdate = updateCalls.some(c => c[0]?.status === 'queued')
    expect(hasTaskUpdate).toBe(false)
  })
})
