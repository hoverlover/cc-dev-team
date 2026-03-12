/**
 * MCP error codes following JSON-RPC conventions.
 * Maps to HTTP status equivalents for transport layer.
 */
export const McpErrorCode = {
  UNAUTHORIZED: -32001,
  NOT_FOUND: -32002,
  SERVICE_UNAVAILABLE: -32003,
  CONFLICT: -32004,
  INVALID_REQUEST: -32600,
} as const

export class McpError extends Error {
  code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'McpError'
    this.code = code
  }
}
