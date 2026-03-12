export interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error'
  agent?: string
  event: string
  [key: string]: unknown
}

export interface TokenCost {
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface CostSummary {
  totalInputTokens: number
  totalOutputTokens: number
  totalCostUsd: number
  byAgent: Record<string, TokenCost>
  byProvider: Record<string, TokenCost>
}
