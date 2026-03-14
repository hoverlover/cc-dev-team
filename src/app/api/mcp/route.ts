import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { withAuth } from '../../../lib/auth/middleware'
import { createServer } from './server'
import { McpErrorCode } from './errors'

// Simple in-memory rate limiting (resets per serverless function lifecycle)
const requestCounts = new Map<string, { count: number; resetAt: number }>()

const RATE_LIMIT = 100
const RATE_WINDOW_MS = 60 * 1000

function checkRateLimit(tenantId: string): { remaining: number; resetAt: number } {
  const now = Date.now()
  let entry = requestCounts.get(tenantId)

  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + RATE_WINDOW_MS }
    requestCounts.set(tenantId, entry)
  }

  entry.count++
  return { remaining: Math.max(0, RATE_LIMIT - entry.count), resetAt: entry.resetAt }
}

function rateLimitHeaders(remaining: number, resetAt: number): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(RATE_LIMIT),
    'X-RateLimit-Remaining': String(remaining),
    'X-RateLimit-Reset': String(Math.ceil(resetAt / 1000)),
  }
}

function jsonError(code: number, message: string, httpStatus: number) {
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code, message },
      id: null,
    }),
    {
      status: httpStatus,
      headers: { 'Content-Type': 'application/json' },
    }
  )
}

async function handleMcpRequest(request: Request): Promise<Response> {
  // Authenticate via CDT API key or session token
  const authResult = await withAuth(request)
  if (authResult instanceof Response) return authResult
  const auth = { tenantId: authResult.tenantId }

  // Rate limiting
  const { remaining, resetAt } = checkRateLimit(auth.tenantId)

  // Create per-request MCP server with auth context
  const mcpServer = createServer(auth)

  // Stateless transport (Vercel serverless — no persistent sessions)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // Stateless mode
    enableJsonResponse: true,
  })

  await mcpServer.connect(transport)

  try {
    const response = await transport.handleRequest(request)

    // Add rate limit headers to response
    const headers = new Headers(response.headers)
    for (const [key, value] of Object.entries(rateLimitHeaders(remaining, resetAt))) {
      headers.set(key, value)
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    })
  } finally {
    await mcpServer.close()
  }
}

export async function POST(request: Request) {
  return handleMcpRequest(request)
}

export async function GET(request: Request) {
  return handleMcpRequest(request)
}

export async function DELETE(request: Request) {
  // Session termination — stateless mode doesn't need this,
  // but return a valid response per MCP spec
  return new Response(null, { status: 405 })
}
