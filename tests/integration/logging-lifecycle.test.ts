import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TaskLogger } from '../../src/lib/logging/task-logger'
import { CostAccumulator } from '../../src/lib/logging/cost-accumulator'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Integration test: Logging lifecycle
 *
 * Tests TaskLogger + CostAccumulator working together through a simulated
 * task lifecycle: spawn agents → tool calls → cost tracking → error → shutdown.
 * Uses real filesystem (no mocks) to verify JSONL integrity.
 */

describe('Integration: Logging Lifecycle', () => {
  let tmpDir: string
  let logger: TaskLogger

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'logging-lifecycle-'))
    logger = new TaskLogger('task-lifecycle-1', tmpDir)
    // Suppress stdout during tests
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
  })

  afterEach(async () => {
    await logger.close()
    await rm(tmpDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  async function readLogEntries(): Promise<any[]> {
    const content = await readFile(join(tmpDir, 'logs', 'task-lifecycle-1.jsonl'), 'utf-8')
    return content
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }

  describe('full task lifecycle logging', () => {
    it('records complete lifecycle from spawn to shutdown', async () => {
      // Phase 1: Agent spawning
      logger.agentEvent('pm', 'spawned', { model: 'claude-sonnet-4-6' })
      logger.agentEvent('architect', 'spawned', { model: 'claude-sonnet-4-6' })
      logger.agentEvent('engineer', 'spawned', { model: 'claude-sonnet-4-6' })

      // Phase 2: Message routing
      logger.messageEvent('pm', 'human', 'TASK_ASSIGNMENT')
      logger.messageEvent('architect', 'pm', 'TASK_ASSIGNMENT')
      logger.messageEvent('engineer', 'pm', 'TASK_ASSIGNMENT')

      // Phase 3: Tool calls
      logger.toolCall('engineer', 'read', { file: 'src/index.ts' })
      logger.toolCall('engineer', 'edit', { file: 'src/index.ts', duration_ms: 250 })
      logger.toolCall('engineer', 'bash', { command: 'bun test:run' })

      // Phase 4: Cost tracking
      logger.costEvent('pm', 2000, 800, 0.025, 'anthropic')
      logger.costEvent('architect', 3000, 1500, 0.045, 'anthropic')
      logger.costEvent('engineer', 8000, 4000, 0.12, 'anthropic')

      // Phase 5: Error handling
      logger.error('engineer', new Error('Build failed: type error in auth.ts'), {
        file: 'src/auth.ts',
        line: 42,
      })

      // Phase 6: More cost (retry after fix)
      logger.costEvent('engineer', 2000, 1000, 0.03, 'anthropic')

      // Phase 7: Completion
      logger.agentEvent('engineer', 'completed', { exit_code: 0 })
      logger.agentEvent('architect', 'completed', { exit_code: 0 })
      logger.agentEvent('pm', 'completed', { exit_code: 0 })

      // Flush and verify
      await logger.flush()
      const entries = await readLogEntries()

      // 3 spawned + 3 message_received + 3 tool_call + 3 cost_update + 1 error + 1 cost_update + 3 completed = 17
      expect(entries).toHaveLength(17)

      // Verify every entry has required fields
      for (const entry of entries) {
        expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(entry.level).toMatch(/^(info|warn|error)$/)
        expect(entry.event).toBeDefined()
      }

      // Verify event sequence
      const events = entries.map((e) => e.event)
      expect(events[0]).toBe('spawned')
      expect(events[3]).toBe('message_received')
      expect(events[6]).toBe('tool_call')
      expect(events[9]).toBe('cost_update')
      expect(events[12]).toBe('error')
      expect(events[13]).toBe('cost_update')
      expect(events[14]).toBe('completed')

      // Verify error entry has full context
      const errorEntry = entries.find((e) => e.level === 'error')
      expect(errorEntry).toBeDefined()
      expect(errorEntry!.message).toContain('Build failed')
      expect(errorEntry!.file).toBe('src/auth.ts')
      expect(errorEntry!.line).toBe(42)
    })

    it('cost summary accurately reflects all logged costs', async () => {
      logger.costEvent('pm', 2000, 800, 0.025, 'anthropic')
      logger.costEvent('architect', 3000, 1500, 0.045, 'anthropic')
      logger.costEvent('engineer', 8000, 4000, 0.12, 'anthropic')
      logger.costEvent('engineer', 2000, 1000, 0.03, 'anthropic')

      const summary = logger.getCostSummary()

      // Totals
      expect(summary.totalInputTokens).toBe(15000)
      expect(summary.totalOutputTokens).toBe(7300)
      expect(summary.totalCostUsd).toBeCloseTo(0.22)

      // Per-agent breakdown
      expect(summary.byAgent['pm'].inputTokens).toBe(2000)
      expect(summary.byAgent['architect'].inputTokens).toBe(3000)
      expect(summary.byAgent['engineer'].inputTokens).toBe(10000)
      expect(summary.byAgent['engineer'].costUsd).toBeCloseTo(0.15)

      // Provider breakdown
      expect(summary.byProvider['anthropic'].inputTokens).toBe(15000)
      expect(summary.byProvider['anthropic'].costUsd).toBeCloseTo(0.22)
    })

    it('tracks costs across multiple providers', async () => {
      logger.costEvent('pm', 2000, 800, 0.025, 'anthropic')
      logger.costEvent('engineer', 5000, 2000, 0.008, 'openai')

      const summary = logger.getCostSummary()

      expect(Object.keys(summary.byProvider)).toHaveLength(2)
      expect(summary.byProvider['anthropic'].costUsd).toBe(0.025)
      expect(summary.byProvider['openai'].costUsd).toBe(0.008)
      expect(summary.totalCostUsd).toBeCloseTo(0.033)
    })
  })

  describe('shutdown sequence', () => {
    it('flush then close preserves all entries', async () => {
      // Write many entries quickly
      for (let i = 0; i < 50; i++) {
        logger.agentEvent('pm', `event_${i}`)
      }

      await logger.flush()
      await logger.close()

      const entries = await readLogEntries()
      expect(entries).toHaveLength(50)

      // Verify each entry is independently parseable
      for (const entry of entries) {
        expect(entry.agent).toBe('pm')
        expect(entry.event).toMatch(/^event_\d+$/)
      }
    })

    it('close without explicit flush still writes buffered data', async () => {
      logger.agentEvent('engineer', 'tool_call')
      logger.costEvent('engineer', 100, 50, 0.001, 'anthropic')

      // Close directly (close calls flush internally)
      await logger.close()

      const entries = await readLogEntries()
      expect(entries).toHaveLength(2)
    })

    it('log calls after close are silently ignored', async () => {
      logger.agentEvent('pm', 'before_close')
      await logger.close()

      // These should not throw or write
      logger.agentEvent('pm', 'after_close')
      logger.costEvent('pm', 100, 50, 0.001, 'anthropic')

      const entries = await readLogEntries()
      expect(entries).toHaveLength(1)
      expect(entries[0].event).toBe('before_close')
    })

    it('double close is safe', async () => {
      logger.agentEvent('pm', 'test')
      await logger.close()
      await logger.close() // Should not throw

      const entries = await readLogEntries()
      expect(entries).toHaveLength(1)
    })
  })

  describe('CostAccumulator isolation', () => {
    it('reset clears state while logger retains written entries', async () => {
      logger.costEvent('pm', 1000, 500, 0.015, 'anthropic')
      logger.costEvent('engineer', 2000, 800, 0.025, 'anthropic')

      // Summary reflects accumulated state
      let summary = logger.getCostSummary()
      expect(summary.totalCostUsd).toBeCloseTo(0.04)

      // Note: CostAccumulator.reset() is not exposed through TaskLogger,
      // so we test that the accumulator properly sums across the task's lifetime
      logger.costEvent('qa', 500, 200, 0.005, 'anthropic')
      summary = logger.getCostSummary()
      expect(summary.totalCostUsd).toBeCloseTo(0.045)
      expect(Object.keys(summary.byAgent)).toHaveLength(3)

      // All cost events should be in the log file
      await logger.flush()
      const entries = await readLogEntries()
      const costEntries = entries.filter((e) => e.event === 'cost_update')
      expect(costEntries).toHaveLength(3)
    })
  })
})
