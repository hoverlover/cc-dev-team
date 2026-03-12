import { spawn } from 'child_process'
import { createInterface } from 'readline'

/**
 * Spawns a Pi agent in RPC mode (stdin/stdout JSONL pipes).
 *
 * @param {string} role - Agent role (e.g., 'pm', 'architect', 'engineer')
 * @param {object} config
 * @param {string} config.systemPrompt - Path to the agent's system prompt file
 * @param {string} config.workDir - Working directory for the agent
 * @param {object} config.env - Additional environment variables
 * @param {function} [config.onEvent] - Callback for parsed JSONL events from stdout
 * @param {function} [config.onExit] - Callback when the process exits
 * @returns {object} Agent handle with send/prompt/steer/abort/kill methods
 */
export function spawnCloudAgent(role, config) {
  const { systemPrompt, workDir, env = {}, onEvent, onExit } = config

  const args = ['--mode', 'rpc', '--system-prompt', systemPrompt]

  const proc = spawn('pi', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    cwd: workDir
  })

  // JSONL reader on stdout
  const reader = createInterface({ input: proc.stdout })
  reader.on('line', (line) => {
    try {
      const event = JSON.parse(line)
      if (onEvent) onEvent(event)
    } catch {
      // Non-JSON output — log but don't crash
      console.warn(`[CloudAgent:${role}] Non-JSON stdout: ${line}`)
    }
  })

  // Log stderr
  proc.stderr.on('data', (data) => {
    console.error(`[CloudAgent:${role}:stderr] ${data.toString().trim()}`)
  })

  proc.on('exit', (code, signal) => {
    if (onExit) onExit(code, signal)
  })

  const agent = {
    proc,
    role,

    /** Send raw JSONL command via stdin */
    send(command) {
      proc.stdin.write(JSON.stringify(command) + '\n')
    },

    /** Send a prompt to the agent (uses 'message' field per Pi RPC protocol) */
    prompt(text) {
      agent.send({ type: 'prompt', message: text })
    },

    /** Steer the agent with additional context */
    steer(text) {
      agent.send({ type: 'steer', message: text })
    },

    /** Send a follow-up message */
    followUp(text) {
      agent.send({ type: 'follow_up', message: text })
    },

    /** Abort the current operation */
    abort() {
      agent.send({ type: 'abort' })
    },

    /** Kill the process */
    kill() {
      proc.kill('SIGTERM')
    }
  }

  return agent
}
