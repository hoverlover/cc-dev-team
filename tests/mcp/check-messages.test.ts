import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/supabase', () => ({
  createAdminClient: vi.fn(),
}))

import { handleCheckMessages } from '../../src/app/api/mcp/tools/check-messages'
import { createAdminClient } from '../../src/db/supabase'

function createChainableQuery(resolvedData: any) {
  // Creates a proxy that returns itself for any chained method call,
  // but resolves to { data } when awaited (via .then)
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: any) => resolve({ data: resolvedData })
      }
      return (..._args: any[]) => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

function createTrackingQuery(resolvedData: any) {
  // Like chainable query but tracks which methods were called
  const calls: Array<{ method: string; args: any[] }> = []
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: any) => resolve({ data: resolvedData })
      }
      if (prop === '__calls') {
        return calls
      }
      return (...args: any[]) => {
        calls.push({ method: prop as string, args })
        return new Proxy({}, handler)
      }
    },
  }
  return new Proxy({}, handler)
}

function mockDb(messages: any[] = [], projectRows: any[] = [{ id: 'proj-1' }]) {
  let pmOutboxQuery: any
  const updateCalls: any[] = []
  const mockClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'pm_outbox') {
        pmOutboxQuery = createTrackingQuery(messages)
        return {
          select: () => pmOutboxQuery,
          update: vi.fn().mockImplementation((data: any) => {
            updateCalls.push(data)
            return { eq: vi.fn().mockResolvedValue({}) }
          }),
        }
      }
      if (table === 'projects') {
        return {
          select: () => createChainableQuery(projectRows),
        }
      }
      return {}
    }),
  }
  vi.mocked(createAdminClient).mockReturnValue(mockClient as any)
  return { mockClient, getPmOutboxCalls: () => pmOutboxQuery?.__calls ?? [], updateCalls }
}

describe('handleCheckMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty messages array when none exist', async () => {
    mockDb([])
    const result = await handleCheckMessages({ tenantId: 'tenant-1' })
    expect(result.messages).toEqual([])
  })

  it('returns messages with all expected fields', async () => {
    const msg = {
      id: 'msg-1',
      task_id: 'task-1',
      type: 'question',
      content: 'Need clarification on requirements',
      requires_response: true,
      response: null,
      created_at: '2026-03-10T00:00:00Z',
      read_at: null,
      tasks: { projects: { name: 'my-project' } },
    }
    mockDb([msg])

    const result = await handleCheckMessages({ tenantId: 'tenant-1' })

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toMatchObject({
      id: 'msg-1',
      task_id: 'task-1',
      type: 'question',
      content: 'Need clarification on requirements',
      requires_response: true,
    })
  })

  it('defaults to unread_only=true and applies is(read_at, null) filter', async () => {
    const { getPmOutboxCalls } = mockDb([])
    await handleCheckMessages({ tenantId: 'tenant-1' })

    const calls = getPmOutboxCalls()
    const isCall = calls.find((c: any) => c.method === 'is')
    expect(isCall).toBeDefined()
    expect(isCall.args[0]).toBe('read_at')
    expect(isCall.args[1]).toBeNull()
  })

  it('skips read_at filter when unread_only is false', async () => {
    const { getPmOutboxCalls } = mockDb([])
    await handleCheckMessages({ tenantId: 'tenant-1', unread_only: false })

    const calls = getPmOutboxCalls()
    const isCall = calls.find((c: any) => c.method === 'is')
    expect(isCall).toBeUndefined()
  })

  it('filters by project when specified', async () => {
    const { mockClient } = mockDb([], [{ id: 'proj-42' }])
    await handleCheckMessages({ tenantId: 'tenant-1', project: 'my-project' })

    // Verify projects table was queried for project resolution
    const fromCalls = mockClient.from.mock.calls.map((c: any) => c[0])
    expect(fromCalls).toContain('projects')
  })

  it('throws NOT_FOUND when project filter specifies nonexistent project', async () => {
    mockDb([], []) // No project rows
    await expect(
      handleCheckMessages({ tenantId: 'tenant-1', project: 'nonexistent' })
    ).rejects.toMatchObject({
      code: -32002,
      message: expect.stringContaining('not found'),
    })
  })

  it('marks unread messages as read after retrieval', async () => {
    const msg = {
      id: 'msg-1',
      task_id: 'task-1',
      type: 'status_update',
      content: 'Done',
      requires_response: false,
      response: null,
      created_at: '2026-03-10T00:00:00Z',
      read_at: null,
      tasks: { projects: { name: 'proj' } },
    }
    const { updateCalls } = mockDb([msg])
    await handleCheckMessages({ tenantId: 'tenant-1' })

    expect(updateCalls.length).toBeGreaterThan(0)
    expect(updateCalls[0]).toHaveProperty('read_at')
  })
})
