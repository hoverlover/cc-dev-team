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
import { ensureMachineRunning, findMachineForProject, injectMessage } from '../../src/lib/fly/machines'

const TENANT_ID = 'tenant-e2e'
const PROJECT = { id: 'proj-e2e', name: 'e2e-project' }

/**
 * Stateful mock DB that simulates Supabase behavior across
 * the full submit -> check -> reply flow.
 */
function createStatefulMockDb() {
  const store = {
    tasks: [] as any[],
    pm_outbox: [] as any[],
  }

  function createChain(rows: any[]): any {
    let filteredRows = [...rows]
    const chain: any = {}

    chain.select = vi.fn().mockReturnValue(chain)
    chain.eq = vi.fn().mockImplementation((_col: string, _val: any) => chain)
    chain.in = vi.fn().mockReturnValue(chain)
    chain.is = vi.fn().mockReturnValue(chain)
    chain.order = vi.fn().mockReturnValue(chain)
    chain.limit = vi.fn().mockReturnValue(chain)
    chain.insert = vi.fn().mockImplementation((row: any) => {
      const newRow = { ...row, id: row.id ?? `generated-${Date.now()}` }
      // Store in our state
      return createChain([newRow])
    })
    chain.update = vi.fn().mockImplementation((_data: any) => ({
      eq: vi.fn().mockResolvedValue({ error: null }),
    }))
    chain.then = (resolve: any) => resolve({ data: filteredRows, error: null })

    return chain
  }

  const mockClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'projects') {
        return createChain([PROJECT])
      }
      if (table === 'tasks') {
        return createChain(store.tasks)
      }
      if (table === 'pm_outbox') {
        return createChain(store.pm_outbox)
      }
      if (table === 'machines') {
        return createChain([])
      }
      return createChain([])
    }),
  }

  vi.mocked(createAdminClient).mockReturnValue(mockClient as any)

  return {
    mockClient,
    store,
    addTask(task: any) { store.tasks.push(task) },
    addMessage(msg: any) { store.pm_outbox.push(msg) },
  }
}

describe('E2E Flow: submit_task -> check_messages -> reply_to_message', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes the full task lifecycle flow', async () => {
    const db = createStatefulMockDb()

    // --- Step 1: Submit a task ---
    const createdTask = { id: 'task-e2e-1', status: 'queued' }
    db.addTask(createdTask)
    vi.mocked(ensureMachineRunning).mockResolvedValue({ status: 'starting' } as any)

    const submitResult = await handleSubmitTask({
      tenantId: TENANT_ID,
      project: PROJECT.name,
      title: 'Build login page',
      description: 'Implement OAuth login flow with GitHub provider',
      priority: 'high',
    })

    expect(submitResult.task_id).toBeDefined()
    expect(['queued', 'running']).toContain(submitResult.status)
    expect(ensureMachineRunning).toHaveBeenCalledWith(PROJECT.id, TENANT_ID)
    const taskId = submitResult.task_id

    // --- Step 2: Get task status ---
    // Update task state to simulate progress
    db.store.tasks = [{
      id: taskId,
      title: 'Build login page',
      status: 'running',
      project_id: PROJECT.id,
      result_summary: null,
      github_pr_url: null,
      cost_tokens: { input: 5000, output: 2000 },
      cost_usd: '0.12',
    }]

    const statusResult = await handleGetTaskStatus({
      tenantId: TENANT_ID,
      task_id: taskId,
    })

    expect(statusResult.status).toBe('running')
    expect(statusResult.title).toBe('Build login page')
    expect(statusResult.cost).toEqual({
      tokens: { input: 5000, output: 2000 },
      usd: 0.12,
    })

    // --- Step 3: PM sends a question (simulated by adding to outbox) ---
    const pmQuestion = {
      id: 'msg-e2e-1',
      task_id: taskId,
      tenant_id: TENANT_ID,
      type: 'question',
      content: 'Should we support Google OAuth in addition to GitHub?',
      requires_response: true,
      response: null,
      created_at: '2026-03-11T10:00:00Z',
      read_at: null,
      tasks: { project_id: PROJECT.id, projects: { name: PROJECT.name } },
    }
    db.addMessage(pmQuestion)

    // --- Step 4: Check messages ---
    const messagesResult = await handleCheckMessages({ tenantId: TENANT_ID })

    expect(messagesResult.messages).toHaveLength(1)
    expect(messagesResult.messages[0]).toMatchObject({
      id: 'msg-e2e-1',
      type: 'question',
      content: 'Should we support Google OAuth in addition to GitHub?',
      requires_response: true,
      response: null,
    })

    // --- Step 5: Reply to the question ---
    // Reset db mock so reply_to_message can find the message
    db.store.pm_outbox = [pmQuestion]
    db.store.tasks = [{ id: taskId, project_id: PROJECT.id }]

    const mockMachine = { id: 'machine-1', fly_app_name: 'cdt-e2e' }
    vi.mocked(findMachineForProject).mockResolvedValue(mockMachine as any)
    vi.mocked(injectMessage).mockResolvedValue(undefined)

    const replyResult = await handleReplyToMessage({
      tenantId: TENANT_ID,
      message_id: 'msg-e2e-1',
      response: 'Yes, add Google OAuth as well. Use the same callback pattern.',
    })

    expect(replyResult.ok).toBe(true)
    expect(injectMessage).toHaveBeenCalledWith(
      mockMachine,
      expect.objectContaining({
        to: 'pm',
        type: 'HUMAN_RESPONSE',
        content: 'Yes, add Google OAuth as well. Use the same callback pattern.',
      })
    )
  })

  it('handles task submission when machine is unavailable', async () => {
    const db = createStatefulMockDb()
    db.addTask({ id: 'task-offline', status: 'queued' })
    vi.mocked(ensureMachineRunning).mockRejectedValue(new Error('Fly API timeout'))

    const result = await handleSubmitTask({
      tenantId: TENANT_ID,
      project: PROJECT.name,
      title: 'Offline task',
      description: 'Should still be queued',
    })

    expect(result.task_id).toBeDefined()
    expect(result.status).toBe('queued')
  })

  it('handles reply when machine is stopped (response queued)', async () => {
    const db = createStatefulMockDb()
    db.store.pm_outbox = [{
      id: 'msg-offline',
      task_id: 'task-1',
      tenant_id: TENANT_ID,
      requires_response: true,
      response: null,
    }]
    db.store.tasks = [{ id: 'task-1', project_id: PROJECT.id }]

    vi.mocked(findMachineForProject).mockResolvedValue(null)

    const result = await handleReplyToMessage({
      tenantId: TENANT_ID,
      message_id: 'msg-offline',
      response: 'Answer stored for later',
    })

    expect(result.ok).toBe(true)
    expect(result.note).toContain('queued')
    expect(injectMessage).not.toHaveBeenCalled()
  })
})
