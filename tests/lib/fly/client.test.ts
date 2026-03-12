import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createFlyClient } from '../../../src/lib/fly/client'
import { FlyApiError } from '../../../src/lib/fly/types'

const MOCK_TOKEN = 'fly-test-token'
const MOCK_APP = 'cdt-test-app'
const BASE_URL = `https://api.machines.dev/v1/apps/${MOCK_APP}`

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('FLY_API_TOKEN', MOCK_TOKEN)
  vi.stubEnv('FLY_APP_NAME', MOCK_APP)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('FlyClient', () => {
  describe('createMachine', () => {
    it('sends POST to /machines with correct headers and body', async () => {
      const machine = { id: 'mach-1', name: 'test', state: 'created', region: 'iad' }
      fetchMock.mockResolvedValueOnce(jsonResponse(machine))

      const client = createFlyClient()
      const result = await client.createMachine({
        name: 'test-machine',
        region: 'iad',
        config: {
          image: 'registry.fly.io/cdt:latest',
          env: { NODE_ENV: 'production' },
          guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 1024 },
          auto_destroy: false,
          restart: { policy: 'on-failure' },
          services: [],
          checks: {},
          mounts: [],
          stop_config: { timeout: '10s', signal: 'SIGTERM' },
        },
      })

      expect(result.id).toBe('mach-1')
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/machines`,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: `Bearer ${MOCK_TOKEN}`,
            'Content-Type': 'application/json',
          }),
        })
      )
    })

    it('throws FlyApiError on non-2xx response', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'bad request' }), { status: 400 })
      )

      const client = createFlyClient()
      await expect(client.createMachine({} as any)).rejects.toThrow(FlyApiError)
    })
  })

  describe('getMachine', () => {
    it('sends GET to /machines/:id', async () => {
      const machine = { id: 'mach-1', state: 'started' }
      fetchMock.mockResolvedValueOnce(jsonResponse(machine))

      const client = createFlyClient()
      const result = await client.getMachine('mach-1')

      expect(result.id).toBe('mach-1')
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/machines/mach-1`,
        expect.objectContaining({ method: 'GET' })
      )
    })
  })

  describe('startMachine', () => {
    it('sends POST to /machines/:id/start', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

      const client = createFlyClient()
      await client.startMachine('mach-1')

      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/machines/mach-1/start`,
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  describe('stopMachine', () => {
    it('sends POST to /machines/:id/stop', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

      const client = createFlyClient()
      await client.stopMachine('mach-1')

      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/machines/mach-1/stop`,
        expect.objectContaining({ method: 'POST' })
      )
    })
  })

  describe('destroyMachine', () => {
    it('sends DELETE to /machines/:id', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

      const client = createFlyClient()
      await client.destroyMachine('mach-1')

      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/machines/mach-1`,
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })

  describe('listMachines', () => {
    it('sends GET to /machines', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'mach-1' }, { id: 'mach-2' }]))

      const client = createFlyClient()
      const result = await client.listMachines()

      expect(result).toHaveLength(2)
    })
  })

  describe('waitForState', () => {
    it('resolves when machine reaches target state', async () => {
      fetchMock
        .mockResolvedValueOnce(jsonResponse({ id: 'mach-1', state: 'starting' }))
        .mockResolvedValueOnce(jsonResponse({ id: 'mach-1', state: 'started' }))

      const client = createFlyClient()
      await client.waitForState('mach-1', 'started', 5000, 50)

      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('throws on timeout', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse({ id: 'mach-1', state: 'starting' })))

      const client = createFlyClient()
      await expect(
        client.waitForState('mach-1', 'started', 200, 50)
      ).rejects.toThrow(/timeout/i)
    })
  })

  describe('retry logic', () => {
    it('retries on 5xx errors', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('Server Error', { status: 500 }))
        .mockResolvedValueOnce(jsonResponse({ id: 'mach-1', state: 'started' }))

      const client = createFlyClient()
      const result = await client.getMachine('mach-1')

      expect(result.id).toBe('mach-1')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('does not retry on 4xx errors', async () => {
      fetchMock.mockResolvedValue(new Response('Not Found', { status: 404 }))

      const client = createFlyClient()
      await expect(client.getMachine('nonexistent')).rejects.toThrow(FlyApiError)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
  })

  describe('volume operations', () => {
    it('createVolume sends POST to /volumes', async () => {
      const volume = { id: 'vol-1', name: 'test-vol', size_gb: 10, region: 'iad', state: 'created' }
      fetchMock.mockResolvedValueOnce(jsonResponse(volume))

      const client = createFlyClient()
      const result = await client.createVolume({ name: 'test-vol', size_gb: 10, region: 'iad' })

      expect(result.id).toBe('vol-1')
      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/volumes`,
        expect.objectContaining({ method: 'POST' })
      )
    })

    it('listVolumes sends GET to /volumes', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 'vol-1' }]))

      const client = createFlyClient()
      const result = await client.listVolumes()

      expect(result).toHaveLength(1)
    })

    it('deleteVolume sends DELETE to /volumes/:id', async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))

      const client = createFlyClient()
      await client.deleteVolume('vol-1')

      expect(fetchMock).toHaveBeenCalledWith(
        `${BASE_URL}/volumes/vol-1`,
        expect.objectContaining({ method: 'DELETE' })
      )
    })
  })
})
