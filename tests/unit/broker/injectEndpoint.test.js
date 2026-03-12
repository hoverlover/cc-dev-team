import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createInjectEndpoint } from '../../../broker/lib/injectEndpoint.js'

describe('injectEndpoint', () => {
  let handler
  let mockDb
  let mockDeliverMessage

  beforeEach(() => {
    mockDb = {
      prepare: vi.fn(() => ({
        run: vi.fn(() => ({ lastInsertRowid: 42 }))
      }))
    }
    mockDeliverMessage = vi.fn()

    handler = createInjectEndpoint({
      db: mockDb,
      machineJwt: 'valid-jwt-token',
      sessionId: 'session-123',
      deliverMessage: mockDeliverMessage
    })
  })

  it('returns a request handler function', () => {
    expect(typeof handler).toBe('function')
  })

  it('rejects requests without authorization header', () => {
    const req = {
      method: 'POST',
      url: '/api/inject-message',
      headers: {},
      body: { to: 'pm', type: 'TASK_ASSIGNMENT', content: 'Do something' }
    }
    const res = {
      statusCode: null,
      headers: {},
      body: null,
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(body) { this.body = body }
    }

    handler(req, res)

    expect(res.statusCode).toBe(401)
  })

  it('rejects requests with invalid JWT', () => {
    const req = {
      method: 'POST',
      url: '/api/inject-message',
      headers: { authorization: 'Bearer wrong-token' },
      body: { to: 'pm', type: 'TASK_ASSIGNMENT', content: 'Do something' }
    }
    const res = {
      statusCode: null,
      headers: {},
      body: null,
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(body) { this.body = body }
    }

    handler(req, res)

    expect(res.statusCode).toBe(401)
  })

  it('rejects requests with missing required fields', () => {
    const req = {
      method: 'POST',
      url: '/api/inject-message',
      headers: { authorization: 'Bearer valid-jwt-token' },
      body: { to: 'pm' } // missing type and content
    }
    const res = {
      statusCode: null,
      headers: {},
      body: null,
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(body) { this.body = body }
    }

    handler(req, res)

    expect(res.statusCode).toBe(400)
  })

  it('writes valid message to SQLite and returns success', () => {
    const req = {
      method: 'POST',
      url: '/api/inject-message',
      headers: { authorization: 'Bearer valid-jwt-token' },
      body: { to: 'pm', type: 'TASK_ASSIGNMENT', content: 'Build a feature' }
    }
    const res = {
      statusCode: null,
      headers: {},
      body: null,
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(body) { this.body = body }
    }

    handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(mockDb.prepare).toHaveBeenCalled()
    const data = JSON.parse(res.body)
    expect(data.ok).toBe(true)
  })

  it('calls deliverMessage after writing to SQLite', () => {
    const req = {
      method: 'POST',
      url: '/api/inject-message',
      headers: { authorization: 'Bearer valid-jwt-token' },
      body: { to: 'pm', type: 'TASK_ASSIGNMENT', content: 'Build a feature' }
    }
    const res = {
      statusCode: null,
      headers: {},
      body: null,
      writeHead(code, headers) { this.statusCode = code; this.headers = headers },
      end(body) { this.body = body }
    }

    handler(req, res)

    expect(mockDeliverMessage).toHaveBeenCalledWith('pm', expect.any(String))
  })
})
