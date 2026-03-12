/**
 * Handles graceful SIGTERM shutdown in cloud mode.
 * Aborts agents, flushes state to Supabase, closes SQLite.
 */
export class GracefulShutdown {
  constructor({ supabase, db, agents, machineId, currentTask, heartbeatInterval, taskTimeout }) {
    this.supabase = supabase
    this.db = db
    this.agents = agents
    this.machineId = machineId
    this.currentTask = currentTask
    this.heartbeatInterval = heartbeatInterval
    this.taskTimeout = taskTimeout
    this._executed = false
  }

  async execute() {
    if (this._executed) return
    this._executed = true

    const shutdownStart = Date.now()
    console.log('[Cloud] Graceful shutdown starting...')

    try {
      // 1. Stop timers
      if (this.heartbeatInterval) clearInterval(this.heartbeatInterval)
      if (this.taskTimeout) clearTimeout(this.taskTimeout)

      // 2. Abort all agents
      for (const [role, agent] of this.agents) {
        console.log(`[Cloud] Aborting agent: ${role}`)
        agent.abort()
      }

      // 3. Wait briefly for agents to flush (up to 3 seconds)
      await Promise.race([
        Promise.all([...this.agents.values()].map(a =>
          new Promise(resolve => a.proc.on('exit', resolve))
        )),
        new Promise(resolve => setTimeout(resolve, 3000))
      ])

      // 4. Update task status if in-progress
      if (this.currentTask?.status === 'running') {
        await this.supabase
          .from('tasks')
          .update({
            status: 'queued',
            error: 'Machine stopped during execution'
          })
          .eq('id', this.currentTask.id)
      }

      // 5. Update machine status
      await this.supabase
        .from('machines')
        .update({
          status: 'stopped',
          updated_at: new Date().toISOString()
        })
        .eq('id', this.machineId)

      // 6. Close SQLite
      this.db.close()

      console.log(`[Cloud] Shutdown complete in ${Date.now() - shutdownStart}ms`)
    } catch (err) {
      console.error('[Cloud] Shutdown error:', err)
    }
  }
}
