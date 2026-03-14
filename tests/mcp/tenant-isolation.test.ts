import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/supabase', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('../../src/lib/fly/machines', () => ({
  ensureMachineRunning: vi.fn(),
  findMachineForProject: vi.fn(),
  injectMessage: vi.fn(),
}))

import { handleSubmitTask } from '../../src/app/api/mcp/tools/submit-task'
import { handleGetTaskStatus } from '../../src/app/api/mcp/tools/get-task-status'
import { handleCheckMessages } from '../../src/app/api/mcp/tools/check-messages'
import { handleReplyToMessage } from '../../src/app/api/mcp/tools/reply-to-message'
import { createAdminClient } from '../../src/db/supabase'
import { ensureMachineRunning } from '../../src/lib/fly/machines'

const TENANT_A = 'tenant-aaa'
const TENANT_B = 'tenant-bbb'

function createChainableQuery(resolvedData: any) {
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then') return (resolve: any) => resolve({ data: resolvedData })
      return (..._args: any[]) => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

/**
 * Creates a mock Supabase client that enforces tenant_id filtering.
 * Only returns data when the tenant_id in the .eq() call matches ownerTenantId.
 */
function mockDbWithTenantIsolation(ownerTenantId: string, data: Record<string, any[]>) {
  const mockClient = {
    from: vi.fn().mockImplementation((table: string) => {
      const tableData = data[table] ?? []

      // Track eq calls to check tenant_id filtering
      let matchesTenant = false
      const makeChain = (rows: any[]): any => {
        const chain: any = {}
        const methods = ['select', 'eq', 'in', 'is', 'order', 'limit']
        for (const method of methods) {
          chain[method] = vi.fn().mockImplementation((...args: any[]) => {
            if (method === 'eq' && args[0] === 'tenant_id') {
              matchesTenant = args[1] === ownerTenantId
            }
            return chain
          })
        }
        // insert returns a chain that always resolves (no tenant filter on inserts)
        chain.insert = vi.fn().mockImplementation((_row: any) => {
          const insertChain = makeChain(rows)
          // Force matchesTenant=true for insert results (inserts don't filter by tenant)
          insertChain.then = (resolve: any) => resolve({ data: rows, error: null })
          return insertChain
        })
        // update returns a chain with eq
        chain.update = vi.fn().mockImplementation((_data: any) => ({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }))
        // When awaited, return data only if tenant matches
        chain.then = (resolve: any) => {
          resolve({ data: matchesTenant ? rows : [], error: null })
        }
        return chain
      }

      return makeChain(tableData)
    }),
  }
  vi.mocked(createAdminClient).mockReturnValue(mockClient as any)
  return mockClient
}

describe('Tenant Isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('submit_task', () => {
    it('Tenant A can submit to their own project', async () => {
      mockDbWithTenantIsolation(TENANT_A, {
        projects: [{ id: 'proj-a', name: 'project-a' }],
        tasks: [{ id: 'task-a1', status: 'queued' }],
      })
      vi.mocked(ensureMachineRunning).mockResolvedValue({ status: 'starting' } as any)

      const result = await handleSubmitTask({
        tenantId: TENANT_A,
        project: 'project-a',
        title: 'Test task',
        description: 'Test',
      })
      expect(result.task_id).toBe('task-a1')
    })

    it('Tenant B cannot submit to Tenant A project', async () => {
      mockDbWithTenantIsolation(TENANT_A, {
        projects: [{ id: 'proj-a', name: 'project-a' }],
      })

      await expect(
        handleSubmitTask({
          tenantId: TENANT_B,
          project: 'project-a',
          title: 'Sneaky task',
          description: 'Should fail',
        })
      ).rejects.toMatchObject({
        code: -32002,
        message: expect.stringContaining('not found'),
      })
    })
  })

  describe('get_task_status', () => {
    it('Tenant A can view their own task', async () => {
      mockDbWithTenantIsolation(TENANT_A, {
        tasks: [{
          id: 'task-a1',
          project_id: 'proj-a',
          title: 'My task',
          status: 'running',
          result_summary: null,
          github_pr_url: null,
          cost_tokens: null,
          cost_usd: null,
        }],
        machines: [],
        pm_outbox: [],
      })

      const result = await handleGetTaskStatus({ tenantId: TENANT_A, task_id: 'task-a1' })
      expect(result.status).toBe('running')
      expect(result.title).toBe('My task')
    })

    it('Tenant B cannot view Tenant A task', async () => {
      mockDbWithTenantIsolation(TENANT_A, {
        tasks: [{
          id: 'task-a1',
          title: 'Secret task',
          status: 'running',
        }],
      })

      await expect(
        handleGetTaskStatus({ tenantId: TENANT_B, task_id: 'task-a1' })
      ).rejects.toMatchObject({
        code: -32002,
        message: expect.stringContaining('not found'),
      })
    })
  })

  describe('check_messages', () => {
    it('Tenant A sees their own messages', async () => {
      mockDbWithTenantIsolation(TENANT_A, {
        pm_outbox: [{
          id: 'msg-a1',
          task_id: 'task-a1',
          type: 'question',
          content: 'Need input',
          requires_response: true,
          response: null,
          created_at: '2026-03-10T00:00:00Z',
          read_at: null,
          tasks: { projects: { name: 'project-a' } },
        }],
      })

      const result = await handleCheckMessages({ tenantId: TENANT_A })
      expect(result.messages).toHaveLength(1)
    })

    it('Tenant B sees empty messages for Tenant A data', async () => {
      mockDbWithTenantIsolation(TENANT_A, {
        pm_outbox: [{
          id: 'msg-a1',
          task_id: 'task-a1',
          type: 'question',
          content: 'Secret message',
        }],
      })

      const result = await handleCheckMessages({ tenantId: TENANT_B })
      expect(result.messages).toEqual([])
    })
  })

  describe('reply_to_message', () => {
    it('Tenant B cannot reply to Tenant A message', async () => {
      mockDbWithTenantIsolation(TENANT_A, {
        pm_outbox: [{
          id: 'msg-a1',
          tenant_id: TENANT_A,
          task_id: 'task-a1',
          requires_response: true,
          response: null,
        }],
      })

      await expect(
        handleReplyToMessage({
          tenantId: TENANT_B,
          message_id: 'msg-a1',
          response: 'Unauthorized reply',
        })
      ).rejects.toMatchObject({
        code: -32002,
        message: expect.stringContaining('not found'),
      })
    })
  })
})
