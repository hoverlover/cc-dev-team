import { stat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskLogger } from './task-logger'

interface ShutdownParams {
  taskLogger: TaskLogger
  taskId: string
  supabaseAdmin: {
    from: (table: string) => {
      update: (data: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<{ error: unknown }> }
    }
    storage: {
      from: (bucket: string) => {
        upload: (path: string, data: Buffer, opts: Record<string, unknown>) => Promise<{ error: unknown }>
      }
    }
  }
  onShutdown?: () => Promise<void>
  /** Max time to wait for onShutdown hook (default: 5000ms) */
  shutdownTimeoutMs?: number
  /** Max log file size for upload (default: 5MB) */
  maxLogSizeBytes?: number
  /** Base directory for log files (default: /data) */
  dataDir?: string
}

interface ShutdownResult {
  triggerShutdown: () => Promise<void>
  restore: () => void
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Shutdown timeout after ${ms}ms`)), ms),
  )
}

export function setupShutdownHandler(params: ShutdownParams): ShutdownResult {
  const {
    taskLogger,
    taskId,
    supabaseAdmin,
    onShutdown,
    shutdownTimeoutMs = 5000,
    maxLogSizeBytes = 5 * 1024 * 1024,
    dataDir = '/data',
  } = params

  async function triggerShutdown(): Promise<void> {
    console.log('[shutdown] SIGTERM received, flushing logs...')
    const startTime = Date.now()

    try {
      // 1. Call onShutdown hook with timeout
      if (onShutdown) {
        try {
          await Promise.race([onShutdown(), timeout(shutdownTimeoutMs)])
        } catch (err) {
          console.error('[shutdown] onShutdown hook error or timeout:', err)
        }
      }

      // 2. Flush and close task logger
      await taskLogger.flush()
      const costSummary = taskLogger.getCostSummary()
      await taskLogger.close()

      // 3. Update task in Supabase with final cost
      await supabaseAdmin
        .from('tasks')
        .update({
          cost_tokens: {
            input: costSummary.totalInputTokens,
            output: costSummary.totalOutputTokens,
            by_agent: costSummary.byAgent,
            by_provider: costSummary.byProvider,
          },
          cost_usd: costSummary.totalCostUsd,
          updated_at: new Date().toISOString(),
        })
        .eq('id', taskId)

      // 4. Upload log file to Supabase Storage if under size limit
      const logPath = join(dataDir, 'logs', `${taskId}.jsonl`)
      const fileStat = await stat(logPath).catch(() => null)

      if (fileStat && fileStat.size < maxLogSizeBytes) {
        const logContent = await readFile(logPath)
        await supabaseAdmin.storage
          .from('task-logs')
          .upload(`${taskId}.jsonl`, logContent, {
            contentType: 'application/x-ndjson',
            upsert: true,
          })
      }

      console.log(`[shutdown] Flush complete in ${Date.now() - startTime}ms`)
    } catch (err) {
      console.error('[shutdown] Error during flush:', err)
    }
  }

  const handler = () => {
    triggerShutdown().finally(() => process.exit(0))
  }

  process.on('SIGTERM', handler)

  return {
    triggerShutdown,
    restore: () => process.removeListener('SIGTERM', handler),
  }
}
