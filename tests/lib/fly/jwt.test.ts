import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateMachineJwt, verifyMachineJwt } from '../../../src/lib/fly/jwt'

const TEST_SECRET = 'test-secret-256-bit-key-for-jwt-signing-purposes!!'

beforeEach(() => {
  vi.stubEnv('MACHINE_JWT_SECRET', TEST_SECRET)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('Machine JWT', () => {
  it('generates a valid JWT string', async () => {
    const token = await generateMachineJwt('proj-1', 'tenant-1')
    expect(token).toBeTruthy()
    expect(typeof token).toBe('string')
    // JWT has 3 parts separated by dots
    expect(token.split('.')).toHaveLength(3)
  })

  it('round-trips: generate then verify returns correct claims', async () => {
    const token = await generateMachineJwt('proj-abc', 'tenant-xyz')
    const claims = await verifyMachineJwt(token)

    expect(claims.projectId).toBe('proj-abc')
    expect(claims.tenantId).toBe('tenant-xyz')
  })

  it('includes iat claim', async () => {
    const token = await generateMachineJwt('proj-1', 'tenant-1')
    const claims = await verifyMachineJwt(token)

    // iat should be recent (within last 5 seconds)
    expect(claims.iat).toBeDefined()
    expect(claims.iat!).toBeGreaterThan(Math.floor(Date.now() / 1000) - 5)
  })

  it('rejects tokens signed with wrong secret', async () => {
    const token = await generateMachineJwt('proj-1', 'tenant-1')

    // Change the secret
    vi.stubEnv('MACHINE_JWT_SECRET', 'wrong-secret-that-does-not-match-original!!')

    await expect(verifyMachineJwt(token)).rejects.toThrow()
  })

  it('rejects tampered tokens', async () => {
    const token = await generateMachineJwt('proj-1', 'tenant-1')
    // Tamper with the payload
    const parts = token.split('.')
    parts[1] = parts[1] + 'tampered'
    const tampered = parts.join('.')

    await expect(verifyMachineJwt(tampered)).rejects.toThrow()
  })

  it('rejects expired tokens', async () => {
    // Generate a token that's already expired by mocking Date
    const thirtyOneDaysAgo = Date.now() - 31 * 24 * 60 * 60 * 1000
    vi.setSystemTime(thirtyOneDaysAgo)

    const token = await generateMachineJwt('proj-1', 'tenant-1')

    // Restore time
    vi.useRealTimers()

    await expect(verifyMachineJwt(token)).rejects.toThrow()
  })
})
