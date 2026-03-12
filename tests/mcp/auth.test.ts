import { describe, it, expect, vi, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'

// Mock the DB module
vi.mock('../../src/db/supabase', () => ({
  createAdminClient: vi.fn(),
}))

import { authenticateTenant } from '../../src/app/api/mcp/auth'
import { createAdminClient } from '../../src/db/supabase'

function mockDb(rows: any[] = []) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
  }
  // Final .eq() returns the result
  query.eq.mockImplementation(() => query)
  // Override the last call to return data
  const from = vi.fn().mockReturnValue(query)
  const update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) })
  const updateFrom = vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({}) }) })

  // Build a mock that handles both select and update chains
  const mockClient = {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'cdt_api_keys') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ data: rows }),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({}),
          }),
        }
      }
      return { select: vi.fn().mockReturnThis(), eq: vi.fn() }
    }),
  }

  vi.mocked(createAdminClient).mockReturnValue(mockClient as any)
  return mockClient
}

describe('authenticateTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null for missing auth header', async () => {
    const result = await authenticateTenant('')
    expect(result).toBeNull()
  })

  it('returns null for non-cdt_ prefix', async () => {
    const result = await authenticateTenant('Bearer sk_test_abc123')
    expect(result).toBeNull()
  })

  it('returns null for missing Bearer prefix', async () => {
    const result = await authenticateTenant('cdt_abc12345rest')
    expect(result).toBeNull()
  })

  it('returns null when no matching key prefix found', async () => {
    mockDb([])
    const result = await authenticateTenant('Bearer cdt_abc12345rest')
    expect(result).toBeNull()
  })

  it('returns null when bcrypt comparison fails', async () => {
    mockDb([{
      id: 'key-1',
      tenant_id: 'tenant-1',
      key_hash: await bcrypt.hash('cdt_different_key', 10),
    }])
    const result = await authenticateTenant('Bearer cdt_abc12345rest')
    expect(result).toBeNull()
  })

  it('returns tenantId on valid key match', async () => {
    const rawKey = 'cdt_validkey12345678'
    const keyHash = await bcrypt.hash(rawKey, 10)
    mockDb([{
      id: 'key-1',
      tenant_id: 'tenant-123',
      key_hash: keyHash,
    }])
    const result = await authenticateTenant(`Bearer ${rawKey}`)
    expect(result).toEqual({ tenantId: 'tenant-123' })
  })

  it('updates last_used timestamp on successful auth', async () => {
    const rawKey = 'cdt_validkey12345678'
    const keyHash = await bcrypt.hash(rawKey, 10)
    const mockClient = mockDb([{
      id: 'key-1',
      tenant_id: 'tenant-123',
      key_hash: keyHash,
    }])
    await authenticateTenant(`Bearer ${rawKey}`)

    // Verify update was called (second call to from('cdt_api_keys'))
    const calls = mockClient.from.mock.calls
    const updateCalls = calls.filter((c: any) => c[0] === 'cdt_api_keys')
    expect(updateCalls.length).toBe(2) // select + update
  })
})
