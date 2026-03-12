import { describe, it, expect, vi, beforeEach } from 'vitest'
import { withSession, withApiKey, withAuth } from '../../../src/lib/auth/middleware'

// Mock Supabase clients
const mockGetUser = vi.fn()
const mockSupabaseAdmin = {
  from: vi.fn(() => mockSupabaseAdmin),
  select: vi.fn(() => mockSupabaseAdmin),
  eq: vi.fn(() => mockSupabaseAdmin),
  single: vi.fn(() => ({ data: null, error: null })),
}

vi.mock('../../../src/db/supabase', () => ({
  createUserClient: vi.fn(() => ({
    auth: { getUser: mockGetUser }
  })),
  createAdminClient: vi.fn(() => mockSupabaseAdmin),
}))

// Mock api-keys module
const mockValidateApiKey = vi.fn()
vi.mock('../../../src/lib/auth/api-keys', () => ({
  validateApiKey: (...args: any[]) => mockValidateApiKey(...args),
}))

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/test', { headers })
}

describe('auth middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('withSession', () => {
    it('returns 401 when no authorization header', async () => {
      const result = await withSession(makeRequest())
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(401)
    })

    it('returns 401 when token is invalid', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid' } })

      const result = await withSession(makeRequest({ authorization: 'Bearer bad-token' }))
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(401)
    })

    it('returns 403 when user has no tenant', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
      mockSupabaseAdmin.single.mockReturnValue({ data: null, error: null })

      const result = await withSession(makeRequest({ authorization: 'Bearer valid-token' }))
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(403)
    })

    it('returns tenantId and userId for valid session', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
      mockSupabaseAdmin.single.mockReturnValue({ data: { id: 'tenant-123' }, error: null })

      const result = await withSession(makeRequest({ authorization: 'Bearer valid-token' }))
      expect(result).toEqual({ tenantId: 'tenant-123', userId: 'auth-user-1' })
    })
  })

  describe('withApiKey', () => {
    it('returns null when no authorization header (not an API key request)', async () => {
      const result = await withApiKey(makeRequest())
      expect(result).toBeNull()
    })

    it('returns null when token does not have cdt_ prefix', async () => {
      const result = await withApiKey(makeRequest({ authorization: 'Bearer regular-jwt' }))
      expect(result).toBeNull()
    })

    it('returns 401 when CDT key is invalid', async () => {
      mockValidateApiKey.mockResolvedValue(null)

      const result = await withApiKey(makeRequest({ authorization: 'Bearer cdt_invalidkey' }))
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(401)
    })

    it('returns tenantId for valid CDT API key', async () => {
      mockValidateApiKey.mockResolvedValue('tenant-abc')

      const result = await withApiKey(makeRequest({ authorization: 'Bearer cdt_validkey' }))
      expect(result).toEqual({ tenantId: 'tenant-abc' })
    })
  })

  describe('withAuth', () => {
    it('returns 401 when no auth provided', async () => {
      const result = await withAuth(makeRequest())
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(401)
    })

    it('tries API key first when cdt_ prefix present', async () => {
      mockValidateApiKey.mockResolvedValue('tenant-from-key')

      const result = await withAuth(makeRequest({ authorization: 'Bearer cdt_mykey' }))
      expect(result).toEqual({
        tenantId: 'tenant-from-key',
        authMethod: 'api_key'
      })
      // Should not call getUser since API key matched
      expect(mockGetUser).not.toHaveBeenCalled()
    })

    it('falls back to session when not a CDT key', async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: 'auth-user-1' } }, error: null })
      mockSupabaseAdmin.single.mockReturnValue({ data: { id: 'tenant-session' }, error: null })

      const result = await withAuth(makeRequest({ authorization: 'Bearer session-jwt' }))
      expect(result).toEqual({
        tenantId: 'tenant-session',
        userId: 'auth-user-1',
        authMethod: 'session'
      })
    })

    it('returns 401 when API key is invalid and no session fallback', async () => {
      mockValidateApiKey.mockResolvedValue(null)

      const result = await withAuth(makeRequest({ authorization: 'Bearer cdt_badkey' }))
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(401)
    })
  })
})
