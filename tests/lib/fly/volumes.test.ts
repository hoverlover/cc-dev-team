import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../../src/lib/fly/client', () => ({
  createFlyClient: vi.fn(),
}))

vi.mock('../../../src/db/supabase', () => ({
  createAdminClient: vi.fn(),
}))

import { ensureVolume } from '../../../src/lib/fly/volumes'
import { createFlyClient } from '../../../src/lib/fly/client'
import { createAdminClient } from '../../../src/db/supabase'

function mockFlyClient(overrides: Record<string, any> = {}) {
  const client = {
    createVolume: vi.fn().mockResolvedValue({ id: 'vol-new', name: 'test', size_gb: 10, region: 'iad', state: 'created' }),
    getVolume: vi.fn().mockResolvedValue({ id: 'vol-existing', state: 'created' }),
    ...overrides,
  }
  vi.mocked(createFlyClient).mockReturnValue(client as any)
  return client
}

function mockDb(project: any = null) {
  const mockClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'projects') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: project ? [project] : [] }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      return {}
    }),
  }
  vi.mocked(createAdminClient).mockReturnValue(mockClient as any)
  return mockClient
}

describe('ensureVolume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reuses existing volume when project has fly_volume_id', async () => {
    const flyClient = mockFlyClient()
    mockDb({ id: 'proj-1', fly_volume_id: 'vol-existing' })

    const volumeId = await ensureVolume('proj-1', 'tenant-1')

    expect(volumeId).toBe('vol-existing')
    expect(flyClient.getVolume).toHaveBeenCalledWith('vol-existing')
    expect(flyClient.createVolume).not.toHaveBeenCalled()
  })

  it('creates new volume when project has no fly_volume_id', async () => {
    const flyClient = mockFlyClient()
    mockDb({ id: 'proj-1', fly_volume_id: null })

    const volumeId = await ensureVolume('proj-1', 'tenant-1')

    expect(volumeId).toBe('vol-new')
    expect(flyClient.createVolume).toHaveBeenCalledWith(
      expect.objectContaining({
        size_gb: 10,
        region: 'iad',
      })
    )
  })

  it('creates new volume when existing volume is not found', async () => {
    const flyClient = mockFlyClient({
      getVolume: vi.fn().mockRejectedValue(new Error('not found')),
    })
    mockDb({ id: 'proj-1', fly_volume_id: 'vol-deleted' })

    const volumeId = await ensureVolume('proj-1', 'tenant-1')

    expect(volumeId).toBe('vol-new')
    expect(flyClient.createVolume).toHaveBeenCalled()
  })

  it('updates project with new volume ID after creation', async () => {
    mockFlyClient()
    const db = mockDb({ id: 'proj-1', fly_volume_id: null })

    await ensureVolume('proj-1', 'tenant-1')

    // Verify update was called on projects table
    const updateCalls = db.from.mock.calls.filter((c: any) => c[0] === 'projects')
    expect(updateCalls.length).toBeGreaterThanOrEqual(2) // select + update
  })
})
