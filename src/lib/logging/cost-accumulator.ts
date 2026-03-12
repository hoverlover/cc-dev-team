import type { CostSummary, TokenCost } from './types'

export class CostAccumulator {
  private byAgent = new Map<string, TokenCost>()
  private byProvider = new Map<string, TokenCost>()

  addUsage(agent: string, provider: string, input: number, output: number, costUsd: number): void {
    this.accumulate(this.byAgent, agent, input, output, costUsd)
    this.accumulate(this.byProvider, provider, input, output, costUsd)
  }

  getSummary(): CostSummary {
    let totalInputTokens = 0
    let totalOutputTokens = 0
    let totalCostUsd = 0

    for (const cost of this.byAgent.values()) {
      totalInputTokens += cost.inputTokens
      totalOutputTokens += cost.outputTokens
      totalCostUsd += cost.costUsd
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd,
      byAgent: Object.fromEntries(this.byAgent),
      byProvider: Object.fromEntries(this.byProvider),
    }
  }

  reset(): void {
    this.byAgent.clear()
    this.byProvider.clear()
  }

  private accumulate(map: Map<string, TokenCost>, key: string, input: number, output: number, costUsd: number): void {
    const existing = map.get(key)
    if (existing) {
      existing.inputTokens += input
      existing.outputTokens += output
      existing.costUsd += costUsd
    } else {
      map.set(key, { inputTokens: input, outputTokens: output, costUsd })
    }
  }
}
