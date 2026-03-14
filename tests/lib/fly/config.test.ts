import { describe, it, expect } from 'vitest'
import { buildMachineConfig } from '../../../src/lib/fly/config'

describe('buildMachineConfig', () => {
  it('returns valid CreateMachineRequest structure', () => {
    const config = buildMachineConfig({
      projectId: 'proj-1',
      tenantId: 'tenant-1',
      volumeId: 'vol-1',
      env: { MACHINE_JWT: 'jwt-token', NODE_ENV: 'production' },
    })

    expect(config.config.image).toContain('registry.fly.io')
    expect(config.config.guest.cpu_kind).toBe('shared')
    expect(config.config.guest.cpus).toBe(1)
    expect(config.config.guest.memory_mb).toBe(1024)
    expect(config.config.auto_destroy).toBe(false)
    expect(config.config.restart.policy).toBe('on-failure')
  })

  it('includes volume mount at /data', () => {
    const config = buildMachineConfig({
      projectId: 'proj-1',
      tenantId: 'tenant-1',
      volumeId: 'vol-abc',
      env: {},
    })

    expect(config.config.mounts).toHaveLength(1)
    expect(config.config.mounts[0]).toEqual({ volume: 'vol-abc', path: '/data' })
  })

  it('includes health check on port 8080', () => {
    const config = buildMachineConfig({
      projectId: 'proj-1',
      tenantId: 'tenant-1',
      volumeId: 'vol-1',
      env: {},
    })

    expect(config.config.checks.health).toBeDefined()
    expect(config.config.checks.health.type).toBe('http')
    expect(config.config.checks.health.port).toBe(8080)
    expect(config.config.checks.health.path).toBe('/health')
  })

  it('includes HTTPS service on port 443', () => {
    const config = buildMachineConfig({
      projectId: 'proj-1',
      tenantId: 'tenant-1',
      volumeId: 'vol-1',
      env: {},
    })

    expect(config.config.services).toHaveLength(1)
    const service = config.config.services[0]
    expect(service.internal_port).toBe(8080)
    expect(service.protocol).toBe('tcp')
    expect(service.ports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ port: 443, handlers: ['tls', 'http'] }),
      ])
    )
  })

  it('passes env vars through to config', () => {
    const env = { MACHINE_JWT: 'secret', PROJECT_ID: 'proj-1', CC_MODE: 'cloud' }
    const config = buildMachineConfig({
      projectId: 'proj-1',
      tenantId: 'tenant-1',
      volumeId: 'vol-1',
      env,
    })

    expect(config.config.env).toEqual(env)
  })

  it('generates machine name from project and tenant IDs', () => {
    const config = buildMachineConfig({
      projectId: 'abcdef12-3456-7890-abcd-ef1234567890',
      tenantId: 'fedcba98-7654-3210-fedc-ba9876543210',
      volumeId: 'vol-1',
      env: {},
    })

    expect(config.name).toBeDefined()
    expect(config.name).toContain('cdt-')
  })

  it('sets region to iad', () => {
    const config = buildMachineConfig({
      projectId: 'proj-1',
      tenantId: 'tenant-1',
      volumeId: 'vol-1',
      env: {},
    })

    expect(config.region).toBe('iad')
  })

  it('sets stop_config with 10s timeout', () => {
    const config = buildMachineConfig({
      projectId: 'proj-1',
      tenantId: 'tenant-1',
      volumeId: 'vol-1',
      env: {},
    })

    expect(config.config.stop_config.timeout).toBe('10s')
    expect(config.config.stop_config.signal).toBe('SIGTERM')
  })
})
