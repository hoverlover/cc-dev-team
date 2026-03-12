import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateApiKey, validateApiKey, hashApiKey } from '../../../src/lib/auth/api-keys'

// Mock Supabase admin client
vi.mock('../../../src/db/supabase', () => ({
  createAdminClient: vi.fn(() => mockSupabase)
}))

let mockSupabase: any

describe('api-keys', () => {
  beforeEach(() => {
    vi.stubEnv('CDT_API_KEY_PEPPER', 'test-pepper-secret-value')

    mockSupabase = {
      from: vi.fn(() => mockSupabase),
      insert: vi.fn(() => ({ error: null })),
      select: vi.fn(() => mockSupabase),
      eq: vi.fn(() => mockSupabase),
      update: vi.fn(() => mockSupabase),
      single: vi.fn(() => ({ data: null, error: null })),
    }
  })

  describe('hashApiKey', () => {
    it('produces consistent SHA-256 HMAC hashes', () => {
      const hash1 = hashApiKey('cdt_testkey123')
      const hash2 = hashApiKey('cdt_testkey123')
      expect(hash1).toBe(hash2)
    })

    it('produces different hashes for different keys', () => {
      const hash1 = hashApiKey('cdt_key1')
      const hash2 = hashApiKey('cdt_key2')
      expect(hash1).not.toBe(hash2)
    })

    it('returns a hex string', () => {
      const hash = hashApiKey('cdt_testkey')
      expect(hash).toMatch(/^[0-9a-f]{64}$/)
    })
  })

  describe('generateApiKey', () => {
    it('returns a key with cdt_ prefix', async () => {
      const result = await generateApiKey('tenant-123')
      expect(result.key).toMatch(/^cdt_/)
    })

    it('returns a prefix (first 8 chars)', async () => {
      const result = await generateApiKey('tenant-123')
      expect(result.prefix).toBe(result.key.slice(0, 8))
    })

    it('inserts hashed key into cdt_api_keys table', async () => {
      await generateApiKey('tenant-123', 'My API Key')

      expect(mockSupabase.from).toHaveBeenCalledWith('cdt_api_keys')
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          tenant_id: 'tenant-123',
          key_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
          key_prefix: expect.stringMatching(/^cdt_/),
          label: 'My API Key'
        })
      )
    })

    it('generates unique keys on each call', async () => {
      const result1 = await generateApiKey('tenant-123')
      const result2 = await generateApiKey('tenant-123')
      expect(result1.key).not.toBe(result2.key)
    })
  })

  describe('validateApiKey', () => {
    it('returns tenantId for valid key', async () => {
      // Generate a key first to know its hash
      const { key } = await generateApiKey('tenant-abc')
      const expectedHash = hashApiKey(key)

      // Mock DB to return a match
      mockSupabase.single = vi.fn(() => ({
        data: { tenant_id: 'tenant-abc', id: 'key-id-1' },
        error: null
      }))

      const result = await validateApiKey(key)
      expect(result).toBe('tenant-abc')
    })

    it('returns null for invalid key', async () => {
      mockSupabase.single = vi.fn(() => ({
        data: null,
        error: { message: 'not found' }
      }))

      const result = await validateApiKey('cdt_invalidkey')
      expect(result).toBeNull()
    })

    it('returns null for non-cdt prefixed key', async () => {
      const result = await validateApiKey('not_a_cdt_key')
      expect(result).toBeNull()
    })

    it('updates last_used timestamp on successful validation', async () => {
      mockSupabase.single = vi.fn(() => ({
        data: { tenant_id: 'tenant-abc', id: 'key-id-1' },
        error: null
      }))

      await validateApiKey('cdt_somevalidkey')

      expect(mockSupabase.update).toHaveBeenCalled()
    })
  })
})
