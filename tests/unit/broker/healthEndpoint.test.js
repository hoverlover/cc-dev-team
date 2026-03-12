import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHealthEndpoint } from '../../../broker/lib/healthEndpoint.js'

describe('healthEndpoint', () => {
  let handler

  beforeEach(() => {
    handler = createHealthEndpoint(() => ({
      healthy: true,
      agents: [
        { role: 'pm', status: 'active', pid: 1234 }
      ],
      currentTask: {
        id: 'task-123',
        status: 'running',
        startedAt: '2026-03-11T00:00:00Z'
      }
    }))
  })

  it('returns a request handler function', () => {
    expect(typeof handler).toBe('function')
  })

  it('responds with 200 and health data for GET /health', () => {
    const req = { method: 'GET', url: '/health' }
    const res = {
      statusCode: null,
      headers: {},
      body: null,
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(body) { this.body = body }
    }

    handler(req, res)

    expect(res.statusCode).toBe(200)
    const data = JSON.parse(res.body)
    expect(data.status).toBe('healthy')
    expect(data.mode).toBe('cloud')
    expect(data.agents).toHaveLength(1)
    expect(data.agents[0].role).toBe('pm')
    expect(data.task.id).toBe('task-123')
    expect(data).toHaveProperty('uptime')
  })

  it('returns unhealthy status when state is unhealthy', () => {
    const unhealthyHandler = createHealthEndpoint(() => ({
      healthy: false,
      agents: [],
      currentTask: null
    }))

    const req = { method: 'GET', url: '/health' }
    const res = {
      statusCode: null,
      headers: {},
      body: null,
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(body) { this.body = body }
    }

    unhealthyHandler(req, res)

    expect(res.statusCode).toBe(503)
    const data = JSON.parse(res.body)
    expect(data.status).toBe('unhealthy')
  })

  it('returns null task when no task is active', () => {
    const idleHandler = createHealthEndpoint(() => ({
      healthy: true,
      agents: [{ role: 'pm', status: 'idle', pid: 1234 }],
      currentTask: null
    }))

    const req = { method: 'GET', url: '/health' }
    const res = {
      statusCode: null,
      headers: {},
      body: null,
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(body) { this.body = body }
    }

    idleHandler(req, res)

    const data = JSON.parse(res.body)
    expect(data.task).toBeNull()
  })
})
