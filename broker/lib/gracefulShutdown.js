/**
 * Graceful shutdown coordinator for the broker.
 *
 * Handles SIGTERM by:
 * 1. Setting a shutdown flag (stop accepting new tasks)
 * 2. Sending abort to all registered agents
 * 3. Closing the database
 * 4. Exiting within the grace period (default 10s for Fly.io)
 */

export class GracefulShutdown {
  #agents = new Map()
  #db = null
  #shuttingDown = false
  #graceMs

  constructor({ graceMs = 10000 } = {}) {
    this.#graceMs = graceMs
  }

  get isShuttingDown() {
    return this.#shuttingDown
  }

  setDb(db) {
    this.#db = db
  }

  registerAgent(role, agentHandle) {
    this.#agents.set(role, agentHandle)
  }

  unregisterAgent(role) {
    this.#agents.delete(role)
  }

  initiate() {
    if (this.#shuttingDown) return
    this.#shuttingDown = true

    console.log('[Shutdown] Graceful shutdown initiated')

    // 1. Abort all agents
    for (const [role, handle] of this.#agents) {
      try {
        console.log(`[Shutdown] Aborting agent: ${role}`)
        handle.abort()
      } catch (err) {
        console.error(`[Shutdown] Error aborting ${role}:`, err.message)
      }
    }

    // 2. Close database
    if (this.#db) {
      try {
        this.#db.close()
        console.log('[Shutdown] Database closed')
      } catch (err) {
        console.error('[Shutdown] Error closing database:', err.message)
      }
    }

    // 3. Force exit after grace period
    setTimeout(() => {
      console.log('[Shutdown] Grace period expired, forcing exit')
      process.exit(1)
    }, this.#graceMs).unref()
  }
}
