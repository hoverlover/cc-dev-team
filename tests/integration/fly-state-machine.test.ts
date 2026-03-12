import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Integration test: Fly Machine state transitions
 *
 * Tests ensureMachineRunning and findMachineForProject through all state paths
 * with coordinated DB + Fly API mocks that track state transitions.
 */

let machineDbRows: any[]
let flyMachines: Map<string, { id: string; state: string }>

vi.mock('../../src/lib/fly/client', () => ({
  createFlyClient: vi.fn(() => ({
    createMachine: vi.fn().mockImplementation(async () => {
      const id = `fly-new-${Date.now()}`
      flyMachines.set(id, { id, state: 'created' })
      // Simulate auto-transition to started
      setTimeout(() => {
        const m = flyMachines.get(id)
        if (m) m.state = 'started'
      }, 0)
      return { id, state: 'created' }
    }),
    getMachine: vi.fn().mockImplementation(async (machineId: string) => {
      const m = flyMachines.get(machineId)
      if (!m) throw new Error(`Machine ${machineId} not found`)
      return m
    }),
    startMachine: vi.fn().mockImplementation(async (machineId: string) => {
      const m = flyMachines.get(machineId)
      if (m) m.state = 'starting'
    }),
    stopMachine: vi.fn().mockImplementation(async (machineId: string) => {
      const m = flyMachines.get(machineId)
      if (m) m.state = 'stopped'
    }),
    waitForState: vi.fn().mockImplementation(async (machineId: string, targetState: string) => {
      const m = flyMachines.get(machineId)
      if (m) m.state = targetState
    }),
  })),
}))

vi.mock('../../src/lib/fly/jwt', () => ({
  generateMachineJwt: vi.fn().mockResolvedValue('generated-jwt-token'),
}))

vi.mock('../../src/lib/fly/volumes', () => ({
  ensureVolume: vi.fn().mockResolvedValue('vol-integration-1'),
}))

vi.mock('../../src/db/supabase', () => ({
  createAdminClient: vi.fn(() => createStatefulDb()),
}))

function createStatefulDb() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'machines') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockImplementation(() => {
                    const active = machineDbRows.filter(
                      (m: any) => m.status !== 'destroyed' && m.status !== 'failed'
                    )
                    return Promise.resolve({ data: active, error: null })
                  }),
                }),
              }),
              in: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit: vi.fn().mockImplementation(() => {
                    const running = machineDbRows.filter(
                      (m: any) => ['running', 'idle', 'starting'].includes(m.status)
                    )
                    return Promise.resolve({ data: running, error: null })
                  }),
                }),
              }),
            }),
          }),
          insert: vi.fn().mockImplementation((row: any) => ({
            select: vi.fn().mockImplementation(() => {
              const newRow = { ...row, id: `db-new-${Date.now()}` }
              machineDbRows.push(newRow)
              return Promise.resolve({ data: [newRow], error: null })
            }),
          })),
          update: vi.fn().mockImplementation((data: any) => ({
            eq: vi.fn().mockImplementation((_col: string, val: string) => {
              const row = machineDbRows.find((m: any) => m.id === val)
              if (row) Object.assign(row, data)
              return Promise.resolve({ error: null })
            }),
          })),
        }
      }
      if (table === 'tenant_api_keys') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: [] }) }) }
      }
      if (table === 'github_connections') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        }
      }
      return { select: vi.fn().mockResolvedValue({ data: [] }) }
    }),
    rpc: vi.fn().mockResolvedValue({ data: null }),
  }
}

import { ensureMachineRunning, findMachineForProject } from '../../src/lib/fly/machines'

describe('Integration: Fly Machine State Transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    machineDbRows = []
    flyMachines = new Map()
    vi.stubEnv('FLY_APP_NAME', 'cdt-integration')
    vi.stubEnv('FLY_API_TOKEN', 'test-fly-token')
    vi.stubEnv('MACHINE_JWT_SECRET', 'test-jwt-secret')
    vi.stubEnv('SUPABASE_URL', 'http://localhost:54321')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('ensureMachineRunning state paths', () => {
    it('returns existing running machine without creating new one', async () => {
      const existingMachine = {
        id: 'db-existing',
        project_id: 'proj-1',
        tenant_id: 'tenant-1',
        fly_machine_id: 'fly-existing',
        fly_app_name: 'cdt-integration',
        status: 'running',
        machine_jwt: 'existing-jwt',
      }
      machineDbRows = [existingMachine]
      flyMachines.set('fly-existing', { id: 'fly-existing', state: 'started' })

      const result = await ensureMachineRunning('proj-1', 'tenant-1')

      expect(result.id).toBe('db-existing')
      expect(result.status).toBe('running')
      // No new machine should have been created in Fly
      expect(flyMachines.size).toBe(1)
    })

    it('starts a stopped machine and updates DB status', async () => {
      const stoppedMachine = {
        id: 'db-stopped',
        project_id: 'proj-1',
        tenant_id: 'tenant-1',
        fly_machine_id: 'fly-stopped',
        fly_app_name: 'cdt-integration',
        status: 'stopped',
        machine_jwt: 'existing-jwt',
      }
      machineDbRows = [stoppedMachine]
      flyMachines.set('fly-stopped', { id: 'fly-stopped', state: 'stopped' })

      const result = await ensureMachineRunning('proj-1', 'tenant-1')

      // Machine should now be running
      expect(result.status).toBe('running')
      // Fly API should show started state
      expect(flyMachines.get('fly-stopped')?.state).toBe('started')
    })

    it('creates new machine when none exists', async () => {
      machineDbRows = []

      const result = await ensureMachineRunning('proj-new', 'tenant-1')

      expect(result).toBeDefined()
      expect(result.project_id).toBe('proj-new')
      expect(result.tenant_id).toBe('tenant-1')
      expect(result.status).toBe('running')
      expect(result.machine_jwt).toBe('generated-jwt-token')
      // A new machine should have been created in Fly
      expect(flyMachines.size).toBe(1)
    })

    it('creates new machine when existing machine is destroyed', async () => {
      machineDbRows = [{
        id: 'db-destroyed',
        project_id: 'proj-1',
        tenant_id: 'tenant-1',
        fly_machine_id: 'fly-destroyed',
        status: 'destroyed',
      }]

      // Destroyed machines are filtered out by the DB query, so no active machines found
      const result = await ensureMachineRunning('proj-1', 'tenant-1')

      expect(result).toBeDefined()
      // Should have created a new Fly machine
      expect(flyMachines.size).toBe(1)
    })
  })

  describe('findMachineForProject state reconciliation', () => {
    it('reconciles DB status when Fly state differs', async () => {
      const machine = {
        id: 'db-drift',
        project_id: 'proj-1',
        tenant_id: 'tenant-1',
        fly_machine_id: 'fly-drift',
        fly_app_name: 'cdt-integration',
        status: 'running', // DB thinks running
      }
      machineDbRows = [machine]
      // But Fly says stopped
      flyMachines.set('fly-drift', { id: 'fly-drift', state: 'stopped' })

      const result = await findMachineForProject('proj-1')

      // Should have updated DB to match Fly
      expect(result).toBeDefined()
      expect(result!.status).toBe('stopped')
    })

    it('marks machine as destroyed when Fly API returns 404', async () => {
      const machine = {
        id: 'db-ghost',
        project_id: 'proj-1',
        tenant_id: 'tenant-1',
        fly_machine_id: 'fly-gone',
        status: 'running',
      }
      machineDbRows = [machine]
      // Machine does NOT exist in Fly (getMachine will throw)

      const result = await findMachineForProject('proj-1')

      expect(result).toBeNull()
      // DB should now show destroyed
      expect(machineDbRows[0].status).toBe('destroyed')
    })

    it('returns null when no machines exist for project', async () => {
      machineDbRows = []

      const result = await findMachineForProject('proj-empty')

      expect(result).toBeNull()
    })
  })
})
