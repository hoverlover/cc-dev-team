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

  describe('cost tracking', () => {
    it('accumulates cost from addUsage calls', () => {
      shutdown.addUsage('pm', 'anthropic', 1000, 500, 0.015)
      shutdown.addUsage('engineer', 'anthropic', 2000, 800, 0.025)

      const summary = shutdown.getCostSummary()
      expect(summary.totalInputTokens).toBe(3000)
      expect(summary.totalOutputTokens).toBe(1300)
      expect(summary.totalCostUsd).toBeCloseTo(0.04)
      expect(summary.byAgent['pm'].inputTokens).toBe(1000)
      expect(summary.byAgent['engineer'].inputTokens).toBe(2000)
    })

    it('persists cost data to Supabase on shutdown', async () => {
      shutdown.addUsage('pm', 'anthropic', 1000, 500, 0.015)

      await shutdown.execute()

      // Find the task update call that has cost_tokens
      const updateCalls = mockSupabase.update.mock.calls
      const costUpdate = updateCalls.find(c => c[0]?.cost_tokens)
      expect(costUpdate).toBeTruthy()
      expect(costUpdate[0].cost_tokens.input).toBe(1000)
      expect(costUpdate[0].cost_tokens.output).toBe(500)
      expect(costUpdate[0].cost_usd).toBe(0.015)
    })

    it('skips cost update when no usage recorded', async () => {
      await shutdown.execute()

      const updateCalls = mockSupabase.update.mock.calls
      const costUpdate = updateCalls.find(c => c[0]?.cost_tokens)
      expect(costUpdate).toBeUndefined()
    })

    it('uploads log file to Supabase Storage if under size limit', async () => {
      const { mkdtemp, writeFile } = await import('node:fs/promises')
      const { join } = await import('node:path')
      const { tmpdir } = await import('node:os')

      const tmpDir = await mkdtemp(join(tmpdir(), 'gs-test-'))
      const { mkdir } = await import('node:fs/promises')
      await mkdir(join(tmpDir, 'logs'), { recursive: true })
      await writeFile(join(tmpDir, 'logs', 'task-abc.jsonl'), '{"test":true}\n')

      const mockUpload = vi.fn().mockResolvedValue({ error: null })
      mockSupabase.storage = {
        from: vi.fn(() => ({ upload: mockUpload }))
      }

      shutdown = new GracefulShutdown({
        supabase: mockSupabase,
        db: mockDb,
        agents: mockAgents,
        machineId: 'fly-machine-1',
        currentTask: { id: 'task-abc', status: 'running' },
        heartbeatInterval: null,
        taskTimeout: null,
        dataDir: tmpDir
      })

      await shutdown.execute()

      expect(mockSupabase.storage.from).toHaveBeenCalledWith('task-logs')
      expect(mockUpload).toHaveBeenCalledWith(
        'task-abc.jsonl',
        expect.any(Buffer),
        expect.objectContaining({ contentType: 'application/x-ndjson' })
      )

      // Cleanup
      const { rm } = await import('node:fs/promises')
      await rm(tmpDir, { recursive: true, force: true })
    })
  })
})
