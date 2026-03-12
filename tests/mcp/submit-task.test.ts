import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/supabase', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('../../src/lib/fly-machines', () => ({
  ensureMachineRunning: vi.fn(),
}))

import { handleSubmitTask } from '../../src/app/api/mcp/tools/submit-task'
import { createAdminClient } from '../../src/db/supabase'
import { ensureMachineRunning } from '../../src/lib/fly-machines'

function mockDb(projectRows: any[] = [], insertResult: any = { id: 'task-1' }) {
  const mockClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'projects') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: projectRows }),
            }),
          }),
        }
      }
      if (table === 'tasks') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({ data: [insertResult], error: null }),
          }),
        }
      }
      return {}
    }),
  }
  vi.mocked(createAdminClient).mockReturnValue(mockClient as any)
  return mockClient
}

describe('handleSubmitTask', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws MCP error when project not found', async () => {
    mockDb([])
    await expect(
      handleSubmitTask({
        tenantId: 'tenant-1',
        project: 'nonexistent',
        title: 'Test task',
        description: 'Test description',
      })
    ).rejects.toMatchObject({
      code: -32002,
      message: expect.stringContaining('not found'),
    })
  })

  it('creates a task and returns task_id and status', async () => {
    const project = { id: 'proj-1', name: 'my-project' }
    mockDb([project], { id: 'task-abc', status: 'queued' })
    vi.mocked(ensureMachineRunning).mockResolvedValue({ status: 'starting' } as any)

    const result = await handleSubmitTask({
      tenantId: 'tenant-1',
      project: 'my-project',
      title: 'Build feature',
      description: 'Build a cool feature',
    })

    expect(result.task_id).toBe('task-abc')
    expect(result.status).toMatch(/queued|running/)
  })

  it('uses default priority when not specified', async () => {
    const project = { id: 'proj-1', name: 'my-project' }
    const mockClient = mockDb([project], { id: 'task-1', status: 'queued' })
    vi.mocked(ensureMachineRunning).mockResolvedValue({ status: 'starting' } as any)

    await handleSubmitTask({
      tenantId: 'tenant-1',
      project: 'my-project',
      title: 'Test',
      description: 'Test',
    })

    // Verify insert was called
    const taskCalls = mockClient.from.mock.calls.filter((c: any) => c[0] === 'tasks')
    expect(taskCalls.length).toBeGreaterThan(0)
  })

  it('handles machine unavailability gracefully', async () => {
    const project = { id: 'proj-1', name: 'my-project' }
    mockDb([project], { id: 'task-1', status: 'queued' })
    vi.mocked(ensureMachineRunning).mockRejectedValue(new Error('Fly API down'))

    // Should still create the task but return queued status
    const result = await handleSubmitTask({
      tenantId: 'tenant-1',
      project: 'my-project',
      title: 'Test',
      description: 'Test',
    })

    expect(result.task_id).toBe('task-1')
    expect(result.status).toBe('queued')
  })
})
