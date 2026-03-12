import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../src/lib/fly/client', () => ({
  createFlyClient: vi.fn(),
}))

vi.mock('../../../src/lib/fly/jwt', () => ({
  generateMachineJwt: vi.fn().mockResolvedValue('mock-jwt-token'),
}))

vi.mock('../../../src/lib/fly/volumes', () => ({
  ensureVolume: vi.fn().mockResolvedValue('vol-1'),
}))

vi.mock('../../../src/db/supabase', () => ({
  createAdminClient: vi.fn(),
}))

import { ensureMachineRunning, findMachineForProject, injectMessage } from '../../../src/lib/fly/machines'
import { createFlyClient } from '../../../src/lib/fly/client'
import { createAdminClient } from '../../../src/db/supabase'
import type { MachineRecord } from '../../../src/lib/fly/types'

function mockFlyClient(overrides: Record<string, any> = {}) {
  const client = {
    createMachine: vi.fn().mockResolvedValue({ id: 'fly-mach-1', state: 'created' }),
    getMachine: vi.fn().mockResolvedValue({ id: 'fly-mach-1', state: 'started' }),
    startMachine: vi.fn().mockResolvedValue(undefined),
    stopMachine: vi.fn().mockResolvedValue(undefined),
    waitForState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
  vi.mocked(createFlyClient).mockReturnValue(client as any)
  return client
}

function createChainableQuery(resolvedData: any) {
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === 'then') return (resolve: any) => resolve({ data: resolvedData, error: null })
      return (..._args: any[]) => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

function mockDb(machineRows: any[] = [], projectRows: any[] = []) {
  const insertedRows: any[] = []
  const mockClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'machines') {
        return {
          select: () => createChainableQuery(machineRows),
          insert: vi.fn().mockImplementation((row: any) => {
            insertedRows.push(row)
            return { select: () => createChainableQuery([{ ...row, id: 'db-mach-1' }]) }
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      if (table === 'projects') {
        return {
          select: () => createChainableQuery(projectRows),
        }
      }
      if (table === 'tenant_api_keys') {
        return { select: () => createChainableQuery([]) }
      }
      if (table === 'github_connections') {
        return { select: () => createChainableQuery([]) }
      }
      return { select: () => createChainableQuery([]) }
    }),
    rpc: vi.fn().mockResolvedValue({ data: 'decrypted-secret' }),
  }
  vi.mocked(createAdminClient).mockReturnValue(mockClient as any)
  return { mockClient, insertedRows }
}

describe('ensureMachineRunning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('FLY_APP_NAME', 'cdt-test')
    vi.stubEnv('FLY_API_TOKEN', 'test-token')
    vi.stubEnv('MACHINE_JWT_SECRET', 'test-secret')
    vi.stubEnv('SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns existing running machine', async () => {
    const existingMachine = {
      id: 'db-1',
      project_id: 'proj-1',
      tenant_id: 'tenant-1',
      fly_machine_id: 'fly-1',
      fly_app_name: 'cdt-test',
      status: 'running',
      machine_jwt: 'existing-jwt',
    }
    mockFlyClient()
    mockDb([existingMachine])

    const result = await ensureMachineRunning('proj-1', 'tenant-1')

    expect(result.id).toBe('db-1')
    expect(result.status).toBe('running')
  })

  it('starts a stopped machine', async () => {
    const stoppedMachine = {
      id: 'db-1',
      project_id: 'proj-1',
      tenant_id: 'tenant-1',
      fly_machine_id: 'fly-stopped',
      fly_app_name: 'cdt-test',
      status: 'stopped',
      machine_jwt: 'jwt',
    }
    const flyClient = mockFlyClient()
    mockDb([stoppedMachine])

    const result = await ensureMachineRunning('proj-1', 'tenant-1')

    expect(flyClient.startMachine).toHaveBeenCalledWith('fly-stopped')
    expect(flyClient.waitForState).toHaveBeenCalledWith('fly-stopped', 'started', 30000)
    expect(result.status).toBe('running')
  })

  it('creates a new machine when none exists', async () => {
    const flyClient = mockFlyClient()
    mockDb([], [{ id: 'proj-1', fly_volume_id: null }])

    const result = await ensureMachineRunning('proj-1', 'tenant-1')

    expect(flyClient.createMachine).toHaveBeenCalled()
    expect(flyClient.waitForState).toHaveBeenCalled()
    expect(result).toBeDefined()
  })
})

describe('findMachineForProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('FLY_APP_NAME', 'cdt-test')
    vi.stubEnv('FLY_API_TOKEN', 'test-token')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns machine record when found and fly state matches', async () => {
    const machine = {
      id: 'db-1',
      fly_machine_id: 'fly-1',
      status: 'running',
    }
    mockFlyClient({ getMachine: vi.fn().mockResolvedValue({ id: 'fly-1', state: 'started' }) })
    mockDb([machine])

    const result = await findMachineForProject('proj-1')

    expect(result).toBeDefined()
    expect(result!.id).toBe('db-1')
  })

  it('returns null when no machine exists', async () => {
    mockFlyClient()
    mockDb([])

    const result = await findMachineForProject('proj-1')

    expect(result).toBeNull()
  })

  it('returns null and marks destroyed when fly machine not found', async () => {
    const machine = {
      id: 'db-1',
      fly_machine_id: 'fly-gone',
      status: 'running',
    }
    mockFlyClient({
      getMachine: vi.fn().mockRejectedValue(new Error('not found')),
    })
    const { mockClient } = mockDb([machine])

    const result = await findMachineForProject('proj-1')

    expect(result).toBeNull()
    // Should have called update to mark as destroyed
    const updateCalls = mockClient.from.mock.calls.filter((c: any) => c[0] === 'machines')
    expect(updateCalls.length).toBeGreaterThan(1)
  })
})

describe('injectMessage', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('POSTs to machine inject-message endpoint with JWT auth', async () => {
    fetchMock.mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const machine: MachineRecord = {
      id: 'db-1',
      project_id: 'proj-1',
      tenant_id: 'tenant-1',
      task_id: 'task-1',
      fly_machine_id: 'fly-1',
      fly_app_name: 'cdt-test',
      status: 'running',
      machine_jwt: 'jwt-token',
      agents: null,
      cost_summary: null,
    }

    await injectMessage(machine, {
      type: 'HUMAN_RESPONSE',
      taskId: 'task-1',
      content: 'Yes, proceed',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://cdt-test.fly.dev/api/inject-message',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer jwt-token',
          'Content-Type': 'application/json',
        }),
      })
    )
  })

  it('retries once on 5xx error', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))

    const machine: MachineRecord = {
      id: 'db-1',
      project_id: 'proj-1',
      tenant_id: 'tenant-1',
      task_id: null,
      fly_machine_id: 'fly-1',
      fly_app_name: 'cdt-test',
      status: 'running',
      machine_jwt: 'jwt',
      agents: null,
      cost_summary: null,
    }

    await injectMessage(machine, {
      type: 'TASK_ASSIGNMENT',
      taskId: 'task-1',
      content: 'New task',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('throws on 401/403 without retry', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

    const machine: MachineRecord = {
      id: 'db-1',
      project_id: 'proj-1',
      tenant_id: 'tenant-1',
      task_id: null,
      fly_machine_id: 'fly-1',
      fly_app_name: 'cdt-test',
      status: 'running',
      machine_jwt: 'bad-jwt',
      agents: null,
      cost_summary: null,
    }

    await expect(
      injectMessage(machine, { type: 'CANCEL', taskId: 'task-1', content: 'cancel' })
    ).rejects.toThrow(/unauthorized|jwt/i)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
