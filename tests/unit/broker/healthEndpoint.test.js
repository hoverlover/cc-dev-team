import { describe, it, expect } from 'vitest'
import { createHealthHandler } from '../../../broker/lib/healthEndpoint.js'

describe('broker/lib/healthEndpoint', () => {
  describe('createHealthHandler', () => {
    it('returns a function', () => {
      const handler = createHealthHandler({ getAgents: () => [], getUptime: () => 0 })
      expect(typeof handler).toBe('function')
    })

    it('responds with 200 and health data', () => {
      const agents = ['pm', 'engineer-1']
      const handler = createHealthHandler({
        getAgents: () => agents,
        getUptime: () => 42,
      })

      let statusCode, body
      const res = {
        writeHead(code, headers) { statusCode = code },
        end(data) { body = JSON.parse(data) },
      }

      handler({}, res)

      expect(statusCode).toBe(200)
      expect(body.status).toBe('healthy')
      expect(body.agents).toEqual(['pm', 'engineer-1'])
      expect(body.uptime).toBe(42)
    })

    it('includes mode in response', () => {
      const handler = createHealthHandler({
        getAgents: () => [],
        getUptime: () => 0,
        mode: 'cloud',
      })

      let body
      const res = {
        writeHead() {},
        end(data) { body = JSON.parse(data) },
      }

      handler({}, res)
      expect(body.mode).toBe('cloud')
    })
  })
})
