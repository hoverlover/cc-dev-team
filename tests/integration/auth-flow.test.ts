import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Integration test: Auth flow end-to-end
 *
 * Tests the full CDT API key lifecycle: generate → hash → validate → middleware → tenant context.
 * Mocks only Supabase (external service), tests real module integration.
 */

// Track insert/query state across modules
let dbState: { keys: any[]; tenants: any[] }

vi.mock('../../src/db/supabase', () => ({
  createAdminClient: vi.fn(() => createMockSupabase()),
  createUserClient: vi.fn((token: string) => ({
    auth: {
      getUser: vi.fn().mockImplementation(async () => {
        if (token === 'valid-session-token') {
          return { data: { user: { id: 'auth-user-1' } }, error: null }
        }
        return { data: { user: null }, error: { message: 'invalid token' } }
      }),
    },
  })),
}))

function createMockSupabase() {
  return {
    from: vi.fn().mockImplementation((table: string) => {
      if (table === 'cdt_api_keys') {
        return {
          insert: vi.fn().mockImplementation((row: any) => {
            dbState.keys.push({ ...row, id: `key-${dbState.keys.length + 1}` })
            return { error: null }
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((_col: string, val: string) => ({
              single: vi.fn().mockImplementation(() => {
                const match = dbState.keys.find((k: any) => k.key_hash === val)
                if (match) {
                  return { data: { tenant_id: match.tenant_id, id: match.id || 'key-1' }, error: null }
                }
                return { data: null, error: { message: 'not found' } }
              }),
            })),
          }),
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }
      if (table === 'tenants') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockImplementation((_col: string, val: string) => ({
              single: vi.fn().mockImplementation(() => {
                const tenant = dbState.tenants.find((t: any) => t.auth_id === val)
                if (tenant) return { data: { id: tenant.id }, error: null }
                return { data: null, error: null }
              }),
            })),
          }),
        }
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockReturnValue({ data: null, error: null }),
          }),
        }),
      }
    }),
  }
}

import { hashApiKey, generateApiKey, validateApiKey } from '../../src/lib/auth/api-keys'
import { withSession, withApiKey, withAuth } from '../../src/lib/auth/middleware'

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', { headers })
}

describe('Integration: Auth Flow', () => {
  beforeEach(() => {
    vi.stubEnv('CDT_API_KEY_PEPPER', 'integration-test-pepper')
    dbState = {
      keys: [],
      tenants: [{ id: 'tenant-integration', auth_id: 'auth-user-1' }],
    }
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('API key generate → validate → middleware pipeline', () => {
    it('generated key is validated successfully through middleware', async () => {
      // Step 1: Generate API key
      const { key, prefix } = await generateApiKey('tenant-integration', 'Test Key')

      expect(key).toMatch(/^cdt_/)
      expect(prefix).toBe(key.slice(0, 8))

      // Step 2: Verify the key was stored in DB
      expect(dbState.keys).toHaveLength(1)
      expect(dbState.keys[0].tenant_id).toBe('tenant-integration')
      expect(dbState.keys[0].key_hash).toMatch(/^[0-9a-f]{64}$/)

      // Step 3: Validate key directly
      const tenantId = await validateApiKey(key)
      expect(tenantId).toBe('tenant-integration')

      // Step 4: Validate through withApiKey middleware
      const apiKeyResult = await withApiKey(makeRequest({ authorization: `Bearer ${key}` }))
      expect(apiKeyResult).not.toBeInstanceOf(Response)
      expect((apiKeyResult as { tenantId: string }).tenantId).toBe('tenant-integration')

      // Step 5: Validate through combined withAuth middleware
      const authResult = await withAuth(makeRequest({ authorization: `Bearer ${key}` }))
      expect(authResult).not.toBeInstanceOf(Response)
      const auth = authResult as { tenantId: string; authMethod: string }
      expect(auth.tenantId).toBe('tenant-integration')
      expect(auth.authMethod).toBe('api_key')
    })

    it('hash consistency: same key always produces same hash', () => {
      const key = 'cdt_test-key-consistency-check'
      const hash1 = hashApiKey(key)
      const hash2 = hashApiKey(key)
      const hash3 = hashApiKey(key)

      expect(hash1).toBe(hash2)
      expect(hash2).toBe(hash3)
      expect(hash1).toMatch(/^[0-9a-f]{64}$/)
    })

    it('different keys produce different hashes', async () => {
      const { key: key1 } = await generateApiKey('tenant-1')
      const { key: key2 } = await generateApiKey('tenant-2')

      expect(key1).not.toBe(key2)
      expect(hashApiKey(key1)).not.toBe(hashApiKey(key2))
    })
  })

  describe('session auth → tenant lookup pipeline', () => {
    it('valid session token resolves to tenant context', async () => {
      const result = await withSession(
        makeRequest({ authorization: 'Bearer valid-session-token' })
      )

      expect(result).not.toBeInstanceOf(Response)
      const ctx = result as { tenantId: string; userId: string }
      expect(ctx.tenantId).toBe('tenant-integration')
      expect(ctx.userId).toBe('auth-user-1')
    })

    it('withAuth falls back to session when no cdt_ prefix', async () => {
      const result = await withAuth(
        makeRequest({ authorization: 'Bearer valid-session-token' })
      )

      expect(result).not.toBeInstanceOf(Response)
      const ctx = result as { tenantId: string; userId: string; authMethod: string }
      expect(ctx.tenantId).toBe('tenant-integration')
      expect(ctx.authMethod).toBe('session')
      expect(ctx.userId).toBe('auth-user-1')
    })
  })

  describe('auth rejection paths', () => {
    it('invalid API key returns 401 through full middleware', async () => {
      const result = await withAuth(
        makeRequest({ authorization: 'Bearer cdt_nonexistent_key' })
      )

      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(401)
    })

    it('invalid session token returns 401 through full middleware', async () => {
      const result = await withAuth(
        makeRequest({ authorization: 'Bearer bad-session-token' })
      )

      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(401)
    })

    it('no auth header returns 401 through full middleware', async () => {
      const result = await withAuth(makeRequest())

      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(401)
    })

    it('valid session but unprovisioned tenant returns 403', async () => {
      // Remove tenant from mock state
      dbState.tenants = []

      const result = await withSession(
        makeRequest({ authorization: 'Bearer valid-session-token' })
      )

      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(403)
    })
  })
})
