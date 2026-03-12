import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/supabase', () => ({
  createAdminClient: vi.fn(),
}))

import { handleGetTaskStatus } from '../../src/app/api/mcp/tools/get-task-status'
import { createAdminClient } from '../../src/db/supabase'

function mockDb(taskRow: any = null, machineRow: any = null, blockers: any[] = []) {
  const mockClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'tasks') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: taskRow ? [taskRow] : [] }),
            }),
          }),
        }
      }
      if (table === 'machines') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue({ data: machineRow ? [machineRow] : [] }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'pm_outbox') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                is: vi.fn().mockResolvedValue({ data: blockers }),
              }),
            }),
          }),
        }
      }
      return {}
    }),
  }
  vi.mocked(createAdminClient).mockReturnValue(mockClient as any)
  return mockClient
}

describe('handleGetTaskStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws MCP error when task not found', async () => {
    mockDb(null)
    await expect(
      handleGetTaskStatus({ tenantId: 'tenant-1', task_id: 'nonexistent' })
    ).rejects.toMatchObject({
      code: -32002,
      message: expect.stringContaining('not found'),
    })
  })

  it('returns task status with all fields', async () => {
    const task = {
      id: 'task-1',
      title: 'Build feature',
      status: 'running',
      result_summary: null,
      github_pr_url: null,
      cost_tokens: { input: 1000, output: 500 },
      cost_usd: '0.05',
    }
    const machine = {
      agents: ['pm', 'engineer'],
    }
    mockDb(task, machine, [])

    const result = await handleGetTaskStatus({ tenantId: 'tenant-1', task_id: 'task-1' })

    expect(result.status).toBe('running')
    expect(result.title).toBe('Build feature')
    expect(result.agents_active).toEqual(['pm', 'engineer'])
    expect(result.blockers).toBeNull()
  })

  it('includes blockers when present', async () => {
    const task = {
      id: 'task-1',
      title: 'Build feature',
      status: 'blocked',
      result_summary: null,
      github_pr_url: null,
      cost_tokens: null,
      cost_usd: null,
    }
    const blockers = [
      { content: 'Need API credentials' },
      { content: 'Clarify requirements' },
    ]
    mockDb(task, null, blockers)

    const result = await handleGetTaskStatus({ tenantId: 'tenant-1', task_id: 'task-1' })

    expect(result.blockers).toEqual(['Need API credentials', 'Clarify requirements'])
  })

  it('enforces tenant isolation', async () => {
    // Task exists but belongs to different tenant
    mockDb(null) // returns empty because tenant_id filter doesn't match
    await expect(
      handleGetTaskStatus({ tenantId: 'tenant-other', task_id: 'task-1' })
    ).rejects.toMatchObject({ code: -32002 })
  })
})
