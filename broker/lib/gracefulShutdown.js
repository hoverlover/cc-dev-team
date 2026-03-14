import { stat, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Handles graceful SIGTERM shutdown in cloud mode.
 * Aborts agents, flushes state to Supabase, closes SQLite.
 * Persists cost data and uploads task logs to Supabase Storage.
 */
export class GracefulShutdown {
  constructor({ supabase, db, agents, machineId, currentTask, heartbeatInterval, taskTimeout, dataDir = '/data' }) {
    this.supabase = supabase
    this.db = db
    this.agents = agents
    this.machineId = machineId
    this.currentTask = currentTask
    this.heartbeatInterval = heartbeatInterval
    this.taskTimeout = taskTimeout
    this.dataDir = dataDir
    this._executed = false

    // Cost tracking (per-agent and per-provider)
    this._byAgent = new Map()
    this._byProvider = new Map()
  }

  addUsage(agent, provider, input, output, costUsd) {
    this._accumulate(this._byAgent, agent, input, output, costUsd)
    this._accumulate(this._byProvider, provider, input, output, costUsd)
  }

  getCostSummary() {
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCostUsd = 0
    for (const cost of this._byAgent.values()) {
      totalInputTokens += cost.inputTokens
      totalOutputTokens += cost.outputTokens
      totalCostUsd += cost.costUsd
    }
    return {
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd,
      byAgent: Object.fromEntries(this._byAgent),
      byProvider: Object.fromEntries(this._byProvider),
    }
  }

  _accumulate(map, key, input, output, costUsd) {
    const existing = map.get(key)
    if (existing) {
      existing.inputTokens += input
      existing.outputTokens += output
      existing.costUsd += costUsd
    } else {
      map.set(key, { inputTokens: input, outputTokens: output, costUsd })
    }
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
        const taskUpdate = {
          status: 'queued',
          error: 'Machine stopped during execution'
        }

        // Include cost data if any usage was recorded
        const costSummary = this.getCostSummary()
        if (costSummary.totalInputTokens > 0) {
          taskUpdate.cost_tokens = {
            input: costSummary.totalInputTokens,
            output: costSummary.totalOutputTokens,
            by_agent: costSummary.byAgent,
            by_provider: costSummary.byProvider,
          }
          taskUpdate.cost_usd = costSummary.totalCostUsd
        }

        await this.supabase
          .from('tasks')
          .update(taskUpdate)
          .eq('id', this.currentTask.id)

        // Upload log file to Supabase Storage if it exists and is under 5MB
        await this._uploadLogFile()
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

  async _uploadLogFile() {
    if (!this.currentTask?.id || !this.supabase.storage) return

    const logPath = join(this.dataDir, 'logs', `${this.currentTask.id}.jsonl`)
    try {
      const fileStat = await stat(logPath)
      if (fileStat.size >= 5 * 1024 * 1024) return // skip if over 5MB

      const logContent = await readFile(logPath)
      await this.supabase.storage
        .from('task-logs')
        .upload(`${this.currentTask.id}.jsonl`, logContent, {
          contentType: 'application/x-ndjson',
          upsert: true,
        })
    } catch {
      // Log file doesn't exist or upload failed — not critical
    }
  }
}
