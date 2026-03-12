import { describe, it, expect, beforeEach } from 'vitest'
import { CostAccumulator } from '../../../src/lib/logging/cost-accumulator'

describe('CostAccumulator', () => {
  let accumulator: CostAccumulator

  beforeEach(() => {
    accumulator = new CostAccumulator()
  })

  describe('addUsage', () => {
    it('tracks a single usage entry', () => {
      accumulator.addUsage('pm', 'anthropic', 1000, 500, 0.015)
      const summary = accumulator.getSummary()

      expect(summary.totalInputTokens).toBe(1000)
      expect(summary.totalOutputTokens).toBe(500)
      expect(summary.totalCostUsd).toBe(0.015)
    })

    it('accumulates multiple entries for the same agent', () => {
      accumulator.addUsage('engineer', 'anthropic', 1000, 500, 0.015)
      accumulator.addUsage('engineer', 'anthropic', 2000, 800, 0.025)
      const summary = accumulator.getSummary()

      expect(summary.totalInputTokens).toBe(3000)
      expect(summary.totalOutputTokens).toBe(1300)
      expect(summary.totalCostUsd).toBeCloseTo(0.04)
      expect(summary.byAgent['engineer'].inputTokens).toBe(3000)
      expect(summary.byAgent['engineer'].outputTokens).toBe(1300)
      expect(summary.byAgent['engineer'].costUsd).toBeCloseTo(0.04)
    })

    it('tracks multiple agents separately', () => {
      accumulator.addUsage('pm', 'anthropic', 1000, 500, 0.015)
      accumulator.addUsage('engineer', 'anthropic', 2000, 800, 0.025)
      const summary = accumulator.getSummary()

      expect(summary.totalInputTokens).toBe(3000)
      expect(summary.totalOutputTokens).toBe(1300)
      expect(Object.keys(summary.byAgent)).toHaveLength(2)
      expect(summary.byAgent['pm'].inputTokens).toBe(1000)
      expect(summary.byAgent['engineer'].inputTokens).toBe(2000)
    })

    it('tracks multiple providers separately', () => {
      accumulator.addUsage('pm', 'anthropic', 1000, 500, 0.015)
      accumulator.addUsage('engineer', 'openai', 2000, 800, 0.010)
      const summary = accumulator.getSummary()

      expect(Object.keys(summary.byProvider)).toHaveLength(2)
      expect(summary.byProvider['anthropic'].inputTokens).toBe(1000)
      expect(summary.byProvider['openai'].inputTokens).toBe(2000)
    })

    it('accumulates same provider across different agents', () => {
      accumulator.addUsage('pm', 'anthropic', 1000, 500, 0.015)
      accumulator.addUsage('engineer', 'anthropic', 2000, 800, 0.025)
      const summary = accumulator.getSummary()

      expect(summary.byProvider['anthropic'].inputTokens).toBe(3000)
      expect(summary.byProvider['anthropic'].outputTokens).toBe(1300)
      expect(summary.byProvider['anthropic'].costUsd).toBeCloseTo(0.04)
    })
  })

  describe('getSummary', () => {
    it('returns zeroes when no usage recorded', () => {
      const summary = accumulator.getSummary()

      expect(summary.totalInputTokens).toBe(0)
      expect(summary.totalOutputTokens).toBe(0)
      expect(summary.totalCostUsd).toBe(0)
      expect(summary.byAgent).toEqual({})
      expect(summary.byProvider).toEqual({})
    })
  })

  describe('reset', () => {
    it('clears all accumulated state', () => {
      accumulator.addUsage('pm', 'anthropic', 1000, 500, 0.015)
      accumulator.addUsage('engineer', 'openai', 2000, 800, 0.025)
      accumulator.reset()
      const summary = accumulator.getSummary()

      expect(summary.totalInputTokens).toBe(0)
      expect(summary.totalOutputTokens).toBe(0)
      expect(summary.totalCostUsd).toBe(0)
      expect(summary.byAgent).toEqual({})
      expect(summary.byProvider).toEqual({})
    })

    it('allows new accumulation after reset', () => {
      accumulator.addUsage('pm', 'anthropic', 1000, 500, 0.015)
      accumulator.reset()
      accumulator.addUsage('engineer', 'openai', 500, 200, 0.005)
      const summary = accumulator.getSummary()

      expect(summary.totalInputTokens).toBe(500)
      expect(summary.totalOutputTokens).toBe(200)
      expect(summary.totalCostUsd).toBe(0.005)
      expect(Object.keys(summary.byAgent)).toEqual(['engineer'])
    })
  })
})
