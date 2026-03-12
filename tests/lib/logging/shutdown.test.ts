import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setupShutdownHandler } from '../../../src/lib/logging/shutdown'
import { TaskLogger } from '../../../src/lib/logging/task-logger'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

function createMockSupabase(options?: { updateError?: Error; uploadError?: Error }) {
  const updateFn = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue(
      options?.updateError ? { error: options.updateError } : { error: null },
    ),
  })

  const uploadFn = vi.fn().mockResolvedValue(
    options?.uploadError ? { error: options.uploadError } : { error: null },
  )

  return {
    from: vi.fn().mockReturnValue({ update: updateFn }),
    storage: {
      from: vi.fn().mockReturnValue({ upload: uploadFn }),
    },
    _updateFn: updateFn,
    _uploadFn: uploadFn,
  }
}

describe('setupShutdownHandler', () => {
  let tmpDir: string
  let logger: TaskLogger
  let cleanup: (() => void) | undefined

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'shutdown-test-'))
    logger = new TaskLogger('task-abc', tmpDir)
  })

  afterEach(async () => {
    if (cleanup) cleanup()
    await logger.close().catch(() => {})
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('calls flush, updates Supabase with cost summary, and uploads log file', async () => {
    logger.costEvent('pm', 1000, 500, 0.015, 'anthropic')
    const mockSupabase = createMockSupabase()

    const { triggerShutdown, restore } = setupShutdownHandler({
      taskLogger: logger,
      taskId: 'task-abc',
      supabaseAdmin: mockSupabase as any,
      dataDir: tmpDir,
    })
    cleanup = restore

    await triggerShutdown()

    // Supabase task update was called
    expect(mockSupabase.from).toHaveBeenCalledWith('tasks')
    const updateCall = mockSupabase._updateFn.mock.calls[0][0]
    expect(updateCall.cost_tokens.input).toBe(1000)
    expect(updateCall.cost_tokens.output).toBe(500)
    expect(updateCall.cost_usd).toBe(0.015)

    // Log file was uploaded
    expect(mockSupabase.storage.from).toHaveBeenCalledWith('task-logs')
    expect(mockSupabase._uploadFn).toHaveBeenCalled()
    const uploadArgs = mockSupabase._uploadFn.mock.calls[0]
    expect(uploadArgs[0]).toBe('task-abc.jsonl')
  })

  it('calls onShutdown hook when provided', async () => {
    const onShutdown = vi.fn().mockResolvedValue(undefined)
    const mockSupabase = createMockSupabase()

    const { triggerShutdown, restore } = setupShutdownHandler({
      taskLogger: logger,
      taskId: 'task-abc',
      supabaseAdmin: mockSupabase as any,
      dataDir: tmpDir,
      onShutdown,
    })
    cleanup = restore

    await triggerShutdown()
    expect(onShutdown).toHaveBeenCalled()
  })

  it('times out onShutdown if it hangs', async () => {
    const hangingShutdown = vi.fn().mockImplementation(
      () => new Promise(() => {}), // never resolves
    )
    const mockSupabase = createMockSupabase()

    const { triggerShutdown, restore } = setupShutdownHandler({
      taskLogger: logger,
      taskId: 'task-abc',
      supabaseAdmin: mockSupabase as any,
      dataDir: tmpDir,
      onShutdown: hangingShutdown,
      shutdownTimeoutMs: 100, // short timeout for test
    })
    cleanup = restore

    await triggerShutdown()

    // Should still complete despite hanging onShutdown
    expect(mockSupabase.from).toHaveBeenCalledWith('tasks')
  })

  it('does not upload log file if over size limit', async () => {
    // Write enough data to exceed a small limit
    for (let i = 0; i < 100; i++) {
      logger.agentEvent('pm', 'event', { data: 'x'.repeat(100) })
    }
    await logger.flush()

    const mockSupabase = createMockSupabase()

    const { triggerShutdown, restore } = setupShutdownHandler({
      taskLogger: logger,
      taskId: 'task-abc',
      supabaseAdmin: mockSupabase as any,
      dataDir: tmpDir,
      maxLogSizeBytes: 100, // very small limit
    })
    cleanup = restore

    await triggerShutdown()

    // Task update should still happen
    expect(mockSupabase.from).toHaveBeenCalledWith('tasks')
    // But upload should NOT happen
    expect(mockSupabase._uploadFn).not.toHaveBeenCalled()
  })

  it('handles errors during flush without crashing', async () => {
    const mockSupabase = createMockSupabase({ updateError: new Error('DB down') })

    const { triggerShutdown, restore } = setupShutdownHandler({
      taskLogger: logger,
      taskId: 'task-abc',
      supabaseAdmin: mockSupabase as any,
      dataDir: tmpDir,
    })
    cleanup = restore

    // Should not throw
    await expect(triggerShutdown()).resolves.not.toThrow()
  })
})
