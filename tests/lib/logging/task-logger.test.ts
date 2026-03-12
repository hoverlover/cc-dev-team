import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TaskLogger } from '../../../src/lib/logging/task-logger'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('TaskLogger', () => {
  let tmpDir: string
  let logger: TaskLogger

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'task-logger-test-'))
    logger = new TaskLogger('test-task-123', tmpDir)
  })

  afterEach(async () => {
    await logger.close()
    await rm(tmpDir, { recursive: true, force: true })
  })

  describe('log', () => {
    it('writes valid JSONL entries to log file', async () => {
      logger.log({ ts: '2026-03-11T12:00:00Z', level: 'info', event: 'test_event' })
      await logger.flush()

      const content = await readFile(join(tmpDir, 'logs', 'test-task-123.jsonl'), 'utf-8')
      const lines = content.trim().split('\n')
      expect(lines).toHaveLength(1)

      const entry = JSON.parse(lines[0])
      expect(entry.ts).toBe('2026-03-11T12:00:00Z')
      expect(entry.level).toBe('info')
      expect(entry.event).toBe('test_event')
    })

    it('writes each entry as independently parseable JSON', async () => {
      logger.log({ ts: '2026-03-11T12:00:00Z', level: 'info', event: 'event_1' })
      logger.log({ ts: '2026-03-11T12:00:01Z', level: 'warn', event: 'event_2' })
      logger.log({ ts: '2026-03-11T12:00:02Z', level: 'error', event: 'event_3' })
      await logger.flush()

      const content = await readFile(join(tmpDir, 'logs', 'test-task-123.jsonl'), 'utf-8')
      const lines = content.trim().split('\n')
      expect(lines).toHaveLength(3)

      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    })

    it('includes additional fields in log entry', async () => {
      logger.log({ ts: '2026-03-11T12:00:00Z', level: 'info', event: 'custom', foo: 'bar', count: 42 })
      await logger.flush()

      const content = await readFile(join(tmpDir, 'logs', 'test-task-123.jsonl'), 'utf-8')
      const entry = JSON.parse(content.trim())
      expect(entry.foo).toBe('bar')
      expect(entry.count).toBe(42)
    })
  })

  describe('agentEvent', () => {
    it('writes an agent event with auto-generated timestamp', async () => {
      logger.agentEvent('pm', 'spawned', { model: 'claude-sonnet-4-6' })
      await logger.flush()

      const content = await readFile(join(tmpDir, 'logs', 'test-task-123.jsonl'), 'utf-8')
      const entry = JSON.parse(content.trim())
      expect(entry.level).toBe('info')
      expect(entry.agent).toBe('pm')
      expect(entry.event).toBe('spawned')
      expect(entry.model).toBe('claude-sonnet-4-6')
      expect(entry.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })

  describe('toolCall', () => {
    it('writes a tool_call event', async () => {
      logger.toolCall('engineer', 'edit', { file: 'src/index.ts', duration_ms: 150 })
      await logger.flush()

      const content = await readFile(join(tmpDir, 'logs', 'test-task-123.jsonl'), 'utf-8')
      const entry = JSON.parse(content.trim())
      expect(entry.event).toBe('tool_call')
      expect(entry.agent).toBe('engineer')
      expect(entry.tool).toBe('edit')
      expect(entry.file).toBe('src/index.ts')
      expect(entry.duration_ms).toBe(150)
    })
  })

  describe('messageEvent', () => {
    it('writes a message_received event', async () => {
      logger.messageEvent('engineer', 'pm', 'TASK_ASSIGNMENT')
      await logger.flush()

      const content = await readFile(join(tmpDir, 'logs', 'test-task-123.jsonl'), 'utf-8')
      const entry = JSON.parse(content.trim())
      expect(entry.event).toBe('message_received')
      expect(entry.agent).toBe('engineer')
      expect(entry.from).toBe('pm')
      expect(entry.type).toBe('TASK_ASSIGNMENT')
    })
  })

  describe('costEvent', () => {
    it('writes a cost_update event and accumulates cost', async () => {
      logger.costEvent('pm', 1500, 800, 0.015, 'anthropic')
      await logger.flush()

      const content = await readFile(join(tmpDir, 'logs', 'test-task-123.jsonl'), 'utf-8')
      const entry = JSON.parse(content.trim())
      expect(entry.event).toBe('cost_update')
      expect(entry.agent).toBe('pm')
      expect(entry.input_tokens).toBe(1500)
      expect(entry.output_tokens).toBe(800)
      expect(entry.cost_usd).toBe(0.015)
      expect(entry.provider).toBe('anthropic')
    })

    it('accumulates costs across multiple events', async () => {
      logger.costEvent('pm', 1000, 500, 0.015, 'anthropic')
      logger.costEvent('engineer', 2000, 800, 0.025, 'anthropic')

      const summary = logger.getCostSummary()
      expect(summary.totalInputTokens).toBe(3000)
      expect(summary.totalOutputTokens).toBe(1300)
      expect(summary.totalCostUsd).toBeCloseTo(0.04)
    })
  })

  describe('error', () => {
    it('writes an error event from Error object', async () => {
      logger.error('pm', new Error('Something broke'), { context: 'spawning' })
      await logger.flush()

      const content = await readFile(join(tmpDir, 'logs', 'test-task-123.jsonl'), 'utf-8')
      const entry = JSON.parse(content.trim())
      expect(entry.level).toBe('error')
      expect(entry.event).toBe('error')
      expect(entry.agent).toBe('pm')
      expect(entry.message).toBe('Something broke')
      expect(entry.context).toBe('spawning')
    })

    it('writes an error event from string', async () => {
      logger.error('engineer', 'Connection timeout')
      await logger.flush()

      const content = await readFile(join(tmpDir, 'logs', 'test-task-123.jsonl'), 'utf-8')
      const entry = JSON.parse(content.trim())
      expect(entry.level).toBe('error')
      expect(entry.message).toBe('Connection timeout')
    })
  })

  describe('flush', () => {
    it('ensures all entries are written to disk', async () => {
      for (let i = 0; i < 100; i++) {
        logger.log({ ts: new Date().toISOString(), level: 'info', event: `event_${i}` })
      }
      await logger.flush()

      const content = await readFile(join(tmpDir, 'logs', 'test-task-123.jsonl'), 'utf-8')
      const lines = content.trim().split('\n')
      expect(lines).toHaveLength(100)
    })
  })

  describe('close', () => {
    it('is idempotent', async () => {
      logger.log({ ts: new Date().toISOString(), level: 'info', event: 'test' })
      await logger.close()
      await logger.close() // should not throw
    })
  })

  describe('getCostSummary', () => {
    it('returns empty summary when no costs recorded', () => {
      const summary = logger.getCostSummary()
      expect(summary.totalInputTokens).toBe(0)
      expect(summary.totalOutputTokens).toBe(0)
      expect(summary.totalCostUsd).toBe(0)
    })
  })
})
