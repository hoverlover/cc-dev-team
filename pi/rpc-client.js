/**
 * JSONL protocol handler for Pi RPC communication.
 *
 * Pi's RPC mode uses strict LF-delimited JSONL over stdin/stdout.
 * This module provides a reader that splits on \n boundaries and
 * a helper to send commands as JSONL lines.
 */

/**
 * Reads JSONL from a readable stream, parsing each line as JSON.
 * Uses a simple \n splitter — does NOT use Node's readline
 * (which splits on Unicode line separators inside JSON payloads).
 */
export class JsonlReader {
  #buffer = "";
  #onMessage;
  #onError;

  constructor(stream, onMessage, onError) {
    this.#onMessage = onMessage;
    this.#onError = onError;

    stream.on("data", (chunk) => {
      this.#buffer += chunk.toString("utf-8");
      let newlineIdx;
      while ((newlineIdx = this.#buffer.indexOf("\n")) !== -1) {
        const line = this.#buffer.slice(0, newlineIdx);
        this.#buffer = this.#buffer.slice(newlineIdx + 1);
        if (line.trim()) {
          try {
            this.#onMessage(JSON.parse(line));
          } catch (e) {
            this.#onError?.(e, line);
          }
        }
      }
    });
  }
}

/**
 * Send a JSON command to a Pi RPC process via its stdin.
 */
export function sendRpcCommand(stdin, command) {
  stdin.write(JSON.stringify(command) + "\n");
}

/**
 * Create a high-level RPC client from stdout/stdin streams.
 */
export function createRpcClient(stdout, stdin, onEvent, onError) {
  const reader = new JsonlReader(stdout, onEvent, onError);

  return {
    reader,
    send(command) {
      sendRpcCommand(stdin, command);
    },
  };
}
