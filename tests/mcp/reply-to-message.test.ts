import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/supabase', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('../../src/lib/fly-machines', () => ({
  findMachineForProject: vi.fn(),
  injectMessage: vi.fn(),
}))

import { handleReplyToMessage } from '../../src/app/api/mcp/tools/reply-to-message'
import { createAdminClient } from '../../src/db/supabase'
import { findMachineForProject, injectMessage } from '../../src/lib/fly-machines'

function mockDb(outboxRow: any = null, taskRow: any = null) {
  const mockClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'pm_outbox') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: outboxRow ? [outboxRow] : [] }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      if (table === 'tasks') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: taskRow ? [taskRow] : [] }),
          }),
        }
      }
      return {}
    }),
  }
  vi.mocked(createAdminClient).mockReturnValue(mockClient as any)
  return mockClient
}

describe('handleReplyToMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('throws MCP error when message not found', async () => {
    mockDb(null)
    await expect(
      handleReplyToMessage({
        tenantId: 'tenant-1',
        message_id: 'nonexistent',
        response: 'Yes, proceed',
      })
    ).rejects.toMatchObject({
      code: -32002,
      message: expect.stringContaining('not found'),
    })
  })

  it('throws MCP error when message does not require response', async () => {
    mockDb({
      id: 'msg-1',
      tenant_id: 'tenant-1',
      task_id: 'task-1',
      requires_response: false,
      response: null,
    })
    await expect(
      handleReplyToMessage({
        tenantId: 'tenant-1',
        message_id: 'msg-1',
        response: 'Yes, proceed',
      })
    ).rejects.toMatchObject({
      code: -32004,
    })
  })

  it('throws MCP error when already responded', async () => {
    mockDb({
      id: 'msg-1',
      tenant_id: 'tenant-1',
      task_id: 'task-1',
      requires_response: true,
      response: 'Already answered',
    })
    await expect(
      handleReplyToMessage({
        tenantId: 'tenant-1',
        message_id: 'msg-1',
        response: 'Duplicate response',
      })
    ).rejects.toMatchObject({
      code: -32004,
      message: expect.stringContaining('Already responded'),
    })
  })

  it('stores response and injects message to running machine', async () => {
    const outboxRow = {
      id: 'msg-1',
      tenant_id: 'tenant-1',
      task_id: 'task-1',
      requires_response: true,
      response: null,
    }
    const taskRow = { id: 'task-1', project_id: 'proj-1' }
    mockDb(outboxRow, taskRow)

    const mockMachine = { id: 'machine-1', fly_app_name: 'cdt-app' }
    vi.mocked(findMachineForProject).mockResolvedValue(mockMachine as any)
    vi.mocked(injectMessage).mockResolvedValue(undefined)

    const result = await handleReplyToMessage({
      tenantId: 'tenant-1',
      message_id: 'msg-1',
      response: 'Yes, proceed with the implementation',
    })

    expect(result.ok).toBe(true)
    expect(injectMessage).toHaveBeenCalledWith(
      mockMachine,
      expect.objectContaining({
        to: 'pm',
        type: 'HUMAN_RESPONSE',
        content: 'Yes, proceed with the implementation',
      })
    )
  })

  it('returns ok even when machine is unavailable (response queued)', async () => {
    const outboxRow = {
      id: 'msg-1',
      tenant_id: 'tenant-1',
      task_id: 'task-1',
      requires_response: true,
      response: null,
    }
    const taskRow = { id: 'task-1', project_id: 'proj-1' }
    mockDb(outboxRow, taskRow)

    vi.mocked(findMachineForProject).mockResolvedValue(null)

    const result = await handleReplyToMessage({
      tenantId: 'tenant-1',
      message_id: 'msg-1',
      response: 'Answer',
    })

    expect(result.ok).toBe(true)
    expect(result.note).toContain('queued')
  })
})
