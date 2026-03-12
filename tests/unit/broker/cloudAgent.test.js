import { describe, it, expect, vi, beforeEach } from 'vitest'
import { spawn } from 'child_process'
import { spawnCloudAgent } from '../../../broker/lib/cloudAgent.js'

// Mock child_process
vi.mock('child_process', async () => {
  const { EventEmitter } = await import('events')
  const { PassThrough } = await import('stream')

  function createMockProc() {
    const proc = new EventEmitter()
    proc.stdin = new PassThrough()
    proc.stdout = new PassThrough()
    proc.stderr = new PassThrough()
    proc.pid = 12345
    proc.kill = vi.fn()
    return proc
  }

  return {
    spawn: vi.fn(() => createMockProc())
  }
})

describe('cloudAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('spawnCloudAgent', () => {
    it('spawns pi with --mode rpc and correct args', () => {
      const config = {
        systemPrompt: '/app/agents/pm/SYSTEM.md',
        workDir: '/data/test-project',
        env: { GITHUB_TOKEN: 'test-token' }
      }

      const agent = spawnCloudAgent('pm', config)

      expect(spawn).toHaveBeenCalledWith(
        'pi',
        expect.arrayContaining(['--mode', 'rpc', '--system-prompt', '/app/agents/pm/SYSTEM.md']),
        expect.objectContaining({
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: '/data/test-project'
        })
      )
      expect(agent).toHaveProperty('proc')
      expect(agent).toHaveProperty('send')
      expect(agent).toHaveProperty('prompt')
      expect(agent).toHaveProperty('steer')
      expect(agent).toHaveProperty('abort')
      expect(agent).toHaveProperty('kill')
    })

    it('uses message field not text when sending prompt', () => {
      const config = {
        systemPrompt: '/app/agents/pm/SYSTEM.md',
        workDir: '/data/test-project',
        env: {}
      }

      const agent = spawnCloudAgent('pm', config)
      const writeSpy = vi.spyOn(agent.proc.stdin, 'write')

      agent.prompt('Hello PM')

      expect(writeSpy).toHaveBeenCalledWith(
        JSON.stringify({ type: 'prompt', message: 'Hello PM' }) + '\n'
      )
    })

    it('uses message field for steer commands', () => {
      const config = {
        systemPrompt: '/app/agents/pm/SYSTEM.md',
        workDir: '/data/test-project',
        env: {}
      }

      const agent = spawnCloudAgent('pm', config)
      const writeSpy = vi.spyOn(agent.proc.stdin, 'write')

      agent.steer('New context')

      expect(writeSpy).toHaveBeenCalledWith(
        JSON.stringify({ type: 'steer', message: 'New context' }) + '\n'
      )
    })

    it('abort sends abort command via stdin', () => {
      const config = {
        systemPrompt: '/app/agents/pm/SYSTEM.md',
        workDir: '/data/test-project',
        env: {}
      }

      const agent = spawnCloudAgent('pm', config)
      const writeSpy = vi.spyOn(agent.proc.stdin, 'write')

      agent.abort()

      expect(writeSpy).toHaveBeenCalledWith(
        JSON.stringify({ type: 'abort' }) + '\n'
      )
    })

    it('kill sends SIGTERM to process', () => {
      const config = {
        systemPrompt: '/app/agents/pm/SYSTEM.md',
        workDir: '/data/test-project',
        env: {}
      }

      const agent = spawnCloudAgent('pm', config)
      agent.kill()

      expect(agent.proc.kill).toHaveBeenCalledWith('SIGTERM')
    })

    it('parses JSONL events from stdout and calls onEvent', () => {
      const events = []
      const config = {
        systemPrompt: '/app/agents/pm/SYSTEM.md',
        workDir: '/data/test-project',
        env: {},
        onEvent: (event) => events.push(event)
      }

      const agent = spawnCloudAgent('pm', config)

      // Simulate Pi sending JSONL events
      agent.proc.stdout.push(JSON.stringify({ type: 'agent_start', agent: 'pm' }) + '\n')
      agent.proc.stdout.push(JSON.stringify({ type: 'tool_execution_start', tool: 'Read' }) + '\n')

      // Give readline time to process
      return new Promise(resolve => {
        setTimeout(() => {
          expect(events).toHaveLength(2)
          expect(events[0]).toEqual({ type: 'agent_start', agent: 'pm' })
          expect(events[1]).toEqual({ type: 'tool_execution_start', tool: 'Read' })
          resolve()
        }, 50)
      })
    })

    it('passes env vars through to child process', () => {
      const config = {
        systemPrompt: '/app/agents/pm/SYSTEM.md',
        workDir: '/data/test-project',
        env: {
          GITHUB_TOKEN: 'gh-token',
          ANTHROPIC_API_KEY: 'anthropic-key'
        }
      }

      spawnCloudAgent('pm', config)

      const spawnCall = spawn.mock.calls[0]
      const spawnEnv = spawnCall[2].env
      expect(spawnEnv.GITHUB_TOKEN).toBe('gh-token')
      expect(spawnEnv.ANTHROPIC_API_KEY).toBe('anthropic-key')
    })
  })
})
