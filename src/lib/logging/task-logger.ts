import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { CostAccumulator } from './cost-accumulator'
import type { LogEntry, CostSummary } from './types'

export class TaskLogger {
  private readonly logPath: string
  private stream: WriteStream | null
  private readonly costAccumulator = new CostAccumulator()

  constructor(
    private readonly taskId: string,
    dataDir: string,
  ) {
    const logDir = join(dataDir, 'logs')
    mkdirSync(logDir, { recursive: true })
    this.logPath = join(logDir, `${taskId}.jsonl`)
    this.stream = createWriteStream(this.logPath, { flags: 'a' })
  }

  log(entry: LogEntry): void {
    if (!this.stream) return
    const line = JSON.stringify(entry) + '\n'
    this.stream.write(line)
    process.stdout.write(line)
  }

  agentEvent(agent: string, event: string, data?: Record<string, unknown>): void {
    this.log({ ts: new Date().toISOString(), level: 'info', agent, event, ...data })
  }

  toolCall(agent: string, tool: string, data?: Record<string, unknown>): void {
    this.log({ ts: new Date().toISOString(), level: 'info', agent, event: 'tool_call', tool, ...data })
  }

  messageEvent(agent: string, from: string, type: string): void {
    this.log({ ts: new Date().toISOString(), level: 'info', agent, event: 'message_received', from, type })
  }

  costEvent(agent: string, input: number, output: number, costUsd: number, provider: string): void {
    this.costAccumulator.addUsage(agent, provider, input, output, costUsd)
    this.log({
      ts: new Date().toISOString(),
      level: 'info',
      agent,
      event: 'cost_update',
      input_tokens: input,
      output_tokens: output,
      cost_usd: costUsd,
      provider,
    })
  }

  error(agent: string, error: Error | string, context?: Record<string, unknown>): void {
    const message = error instanceof Error ? error.message : error
    this.log({ ts: new Date().toISOString(), level: 'error', agent, event: 'error', message, ...context })
  }

  async flush(): Promise<void> {
    if (!this.stream) return
    return new Promise<void>((resolve, reject) => {
      this.stream!.write('', (err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  async close(): Promise<void> {
    if (!this.stream) return
    await this.flush()
    return new Promise<void>((resolve) => {
      this.stream!.end(() => {
        this.stream = null
        resolve()
      })
    })
  }

  getCostSummary(): CostSummary {
    return this.costAccumulator.getSummary()
  }
}
