/**
 * Cloud-mode agent spawning for the broker.
 *
 * Wraps pi/broker-rpc.js to spawn Pi agents in RPC mode,
 * with broker-delivered messaging (steer RPC commands).
 */

import { join } from 'path'
import { spawnPiAgent } from '../../pi/broker-rpc.js'

/**
 * Spawn a Pi agent in cloud mode.
 *
 * @param {object} config
 * @param {string} config.role - Agent role (pm, engineer-1, etc.)
 * @param {string} config.projectDir - Working directory
 * @param {string} config.piAgentsDir - Path to pi/agents/ directory
 * @param {string|string[]} config.extensionPath - Path(s) to extension file(s)
 * @param {string} config.provider - LLM provider
 * @param {string} config.model - Model ID
 * @param {function} config.onEvent - RPC event callback
 * @param {function} [config.onExit] - Exit callback
 * @param {function} [config.onError] - Error callback
 * @param {function} [config.onStderr] - Stderr callback
 * @param {object}  [config.env] - Additional env vars
 */
export function spawnCloudAgent(config) {
  // For numbered agents (engineer-2), use base role directory (engineer)
  const baseRole = config.role.replace(/-\d+$/, '')
  const systemPromptPath = join(config.piAgentsDir, baseRole, 'SYSTEM.md')

  const piAgent = spawnPiAgent({
    role: config.role,
    provider: config.provider,
    model: config.model,
    cwd: config.projectDir,
    extensionPath: config.extensionPath,
    systemPromptPath,
    env: {
      CC_AGENT_ROLE: config.role,
      CC_MODE: 'cloud',
      ...config.env,
    },
    onEvent: config.onEvent,
    onError: config.onError,
    onExit: config.onExit,
    onStderr: config.onStderr,
  })

  return {
    role: config.role,
    process: piAgent.process,
    client: piAgent.client,

    /** Send initial prompt to start the agent */
    prompt(message) {
      piAgent.prompt(message)
    },

    /** Deliver a team message via steer RPC */
    deliverMessage(msg) {
      const formatted = `NEW TEAM MESSAGE(S): [MESSAGE from ${msg.from_agent}] [${msg.message_type}]: ${msg.content}`
      piAgent.steer(formatted)
    },

    /** Abort current operation */
    abort() {
      piAgent.abort()
    },

    /** Kill the process */
    kill(signal = 'SIGTERM') {
      piAgent.kill(signal)
    },
  }
}
