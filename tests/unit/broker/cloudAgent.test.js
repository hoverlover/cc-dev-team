import { describe, it, expect, vi, beforeEach } from 'vitest'

// We'll test the cloudAgent module that wraps pi/broker-rpc.js
// for cloud-mode broker integration.

describe('broker/lib/cloudAgent', () => {
  let cloudAgent
  let mockSpawnPiAgent

  beforeEach(async () => {
    vi.resetModules()

    // Mock pi/broker-rpc.js
    mockSpawnPiAgent = vi.fn(() => ({
      role: 'pm',
      process: { pid: 1234, on: vi.fn(), kill: vi.fn() },
      client: { send: vi.fn() },
      prompt: vi.fn(),
      steer: vi.fn(),
      followUp: vi.fn(),
      abort: vi.fn(),
      kill: vi.fn(),
    }))

    vi.doMock('../../../pi/broker-rpc.js', () => ({
      spawnPiAgent: mockSpawnPiAgent,
    }))

    cloudAgent = await import('../../../broker/lib/cloudAgent.js')
  })

  describe('spawnCloudAgent', () => {
    it('spawns a Pi agent with correct config', () => {
      const agent = cloudAgent.spawnCloudAgent({
        role: 'pm',
        projectDir: '/app',
        piAgentsDir: '/app/pi/agents',
        extensionPath: '/app/pi/extensions/cc-dev-team-messaging.ts',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        onEvent: vi.fn(),
        onExit: vi.fn(),
      })

      expect(mockSpawnPiAgent).toHaveBeenCalledTimes(1)
      const config = mockSpawnPiAgent.mock.calls[0][0]
      expect(config.role).toBe('pm')
      expect(config.cwd).toBe('/app')
      expect(config.provider).toBe('anthropic')
      expect(config.model).toBe('claude-sonnet-4-20250514')
      expect(config.systemPromptPath).toContain('pi/agents/pm/SYSTEM.md')
      expect(agent.role).toBe('pm')
    })

    it('uses base role directory for numbered agents', () => {
      cloudAgent.spawnCloudAgent({
        role: 'engineer-2',
        projectDir: '/app',
        piAgentsDir: '/app/pi/agents',
        extensionPath: '/app/pi/extensions/cc-dev-team-messaging.ts',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        onEvent: vi.fn(),
        onExit: vi.fn(),
      })

      const config = mockSpawnPiAgent.mock.calls[0][0]
      expect(config.systemPromptPath).toContain('pi/agents/engineer/SYSTEM.md')
    })

    it('delivers messages via steer RPC', () => {
      const agent = cloudAgent.spawnCloudAgent({
        role: 'pm',
        projectDir: '/app',
        piAgentsDir: '/app/pi/agents',
        extensionPath: '/app/pi/extensions/cc-dev-team-messaging.ts',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        onEvent: vi.fn(),
        onExit: vi.fn(),
      })

      agent.deliverMessage({
        from_agent: 'engineer-1',
        message_type: 'STATUS_UPDATE',
        content: 'Feature done',
      })

      const steerFn = mockSpawnPiAgent.mock.results[0].value.steer
      expect(steerFn).toHaveBeenCalledTimes(1)
      expect(steerFn.mock.calls[0][0]).toContain('engineer-1')
      expect(steerFn.mock.calls[0][0]).toContain('STATUS_UPDATE')
      expect(steerFn.mock.calls[0][0]).toContain('Feature done')
    })
  })
})
