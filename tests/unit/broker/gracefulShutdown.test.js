import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GracefulShutdown } from '../../../broker/lib/gracefulShutdown.js'

describe('broker/lib/gracefulShutdown', () => {
  let shutdown

  beforeEach(() => {
    shutdown = new GracefulShutdown({ graceMs: 100 })
  })

  it('starts not shutting down', () => {
    expect(shutdown.isShuttingDown).toBe(false)
  })

  it('sets shutting down flag on initiate', async () => {
    const mockDb = { close: vi.fn() }
    shutdown.setDb(mockDb)
    shutdown.initiate()
    expect(shutdown.isShuttingDown).toBe(true)
  })

  it('only runs shutdown once', () => {
    const mockDb = { close: vi.fn() }
    shutdown.setDb(mockDb)
    shutdown.initiate()
    shutdown.initiate()
    expect(mockDb.close).toHaveBeenCalledTimes(1)
  })

  it('sends abort to all registered agents', () => {
    const abortFn1 = vi.fn()
    const abortFn2 = vi.fn()
    shutdown.registerAgent('pm', { abort: abortFn1, kill: vi.fn() })
    shutdown.registerAgent('engineer-1', { abort: abortFn2, kill: vi.fn() })

    const mockDb = { close: vi.fn() }
    shutdown.setDb(mockDb)
    shutdown.initiate()

    expect(abortFn1).toHaveBeenCalledTimes(1)
    expect(abortFn2).toHaveBeenCalledTimes(1)
  })

  it('removes agents on unregister', () => {
    const abortFn = vi.fn()
    shutdown.registerAgent('pm', { abort: abortFn, kill: vi.fn() })
    shutdown.unregisterAgent('pm')

    const mockDb = { close: vi.fn() }
    shutdown.setDb(mockDb)
    shutdown.initiate()

    expect(abortFn).not.toHaveBeenCalled()
  })

  it('closes database on shutdown', () => {
    const mockDb = { close: vi.fn() }
    shutdown.setDb(mockDb)
    shutdown.initiate()
    expect(mockDb.close).toHaveBeenCalledTimes(1)
  })
})
