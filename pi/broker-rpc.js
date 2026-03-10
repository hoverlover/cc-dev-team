/**
 * RPC-mode broker for Pi agent orchestration.
 *
 * Spawns Pi agents as child processes in RPC mode and manages
 * communication via JSONL stdin/stdout pipes.
 */

import { spawn } from "child_process";
import { createRpcClient } from "./rpc-client.js";

/**
 * Build the argument list for spawning a Pi RPC agent.
 */
export function buildPiArgs(config) {
  const args = ["--mode", "rpc", "--no-session"];

  args.push("--provider", config.provider);
  args.push("--model", config.model);

  if (config.thinking) {
    args.push("--thinking", config.thinking);
  }

  // Pi does not auto-load SYSTEM.md from cwd — must use --append-system-prompt
  if (config.systemPromptPath) {
    args.push("--append-system-prompt", config.systemPromptPath);
  }

  // Handle single or multiple extension paths
  const extensions = Array.isArray(config.extensionPath)
    ? config.extensionPath
    : config.extensionPath
      ? [config.extensionPath]
      : [];

  for (const ext of extensions) {
    args.push("-e", ext);
  }

  return args;
}

/**
 * Map a Pi RPC event to a broker status string.
 * Returns null if the event doesn't change status.
 */
export function mapEventToStatus(event) {
  switch (event.type) {
    case "agent_start":
      return "working";
    case "tool_execution_start":
      return `working:${event.toolName}`;
    case "tool_execution_end":
      return "working";
    case "message_update":
      if (event.assistantMessageEvent?.type === "text_delta") {
        return "thinking";
      }
      return null;
    case "agent_end":
      return "idle";
    default:
      return null;
  }
}

/**
 * Tracks status per agent, normalizing tool-specific statuses
 * (e.g., "working:bash" → "working") for change detection.
 */
export class AgentStatusTracker {
  #statuses = new Map();
  #listeners = [];

  get(role) {
    return this.#statuses.get(role) ?? "idle";
  }

  getAll() {
    return Object.fromEntries(this.#statuses);
  }

  onChange(listener) {
    this.#listeners.push(listener);
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  processEvent(role, event) {
    const newStatus = mapEventToStatus(event);
    if (newStatus === null) return;

    const prev = this.get(role);
    // Normalize for change detection: "working:bash" and "working" are same base
    const prevBase = prev.split(":")[0];
    const newBase = newStatus.split(":")[0];

    this.#statuses.set(role, newStatus);

    if (prevBase !== newBase) {
      for (const listener of this.#listeners) {
        listener(role, newStatus, prev);
      }
    }
  }
}

/**
 * Spawn a Pi agent in RPC mode.
 *
 * @param {object} config
 * @param {string} config.role - Agent role (pm, architect, engineer, etc.)
 * @param {string} config.provider - LLM provider (anthropic, openai, google, etc.)
 * @param {string} config.model - Model ID
 * @param {string} config.cwd - Working directory for the agent
 * @param {string|string[]} [config.extensionPath] - Path(s) to extension file(s)
 * @param {string} [config.systemPromptPath] - Path to SYSTEM.md (Pi requires --append-system-prompt)
 * @param {string} [config.thinking] - Thinking level
 * @param {object} [config.env] - Additional environment variables
 * @param {function} config.onEvent - Callback for RPC events
 * @param {function} [config.onError] - Callback for JSONL parse errors
 * @param {function} [config.onExit] - Callback when process exits
 * @param {function} [config.onStderr] - Callback for stderr output
 */
export function spawnPiAgent(config) {
  const args = buildPiArgs(config);

  const proc = spawn("pi", args, {
    cwd: config.cwd,
    env: {
      ...process.env,
      ...config.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });

  const client = createRpcClient(proc.stdout, proc.stdin, config.onEvent, config.onError);

  // Collect stderr for logging/debugging
  if (config.onStderr) {
    proc.stderr.on("data", (chunk) => {
      config.onStderr(chunk.toString("utf-8"));
    });
  }

  proc.on("exit", (code, signal) => {
    config.onExit?.(code, signal);
  });

  return {
    role: config.role,
    process: proc,
    client,
    provider: config.provider,
    model: config.model,

    /** Send a prompt to the agent */
    prompt(message) {
      client.send({ type: "prompt", message });
    },

    /** Steer the agent mid-task */
    steer(message) {
      client.send({ type: "steer", message });
    },

    /** Queue a follow-up message */
    followUp(message) {
      client.send({ type: "follow_up", message });
    },

    /** Get session stats */
    getStats() {
      client.send({ type: "get_session_stats" });
    },

    /** Set steering mode */
    setSteeringMode(mode = "all") {
      client.send({ type: "set_steering_mode", mode });
    },

    /** Set model mid-session */
    setModel(provider, modelId) {
      client.send({ type: "set_model", provider, modelId });
    },

    /** Abort current operation */
    abort() {
      client.send({ type: "abort" });
    },

    /** Kill the process */
    kill(signal = "SIGTERM") {
      proc.kill(signal);
    },
  };
}
