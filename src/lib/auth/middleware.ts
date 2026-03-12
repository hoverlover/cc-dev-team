import { createUserClient, createAdminClient } from '../../db/supabase'
import { validateApiKey } from './api-keys'

/**
 * Validate a Supabase session token (browser/workbench requests).
 * Returns tenantId + userId on success, or a 401/403 Response on failure.
 */
export async function withSession(
  request: Request
): Promise<{ tenantId: string; userId: string } | Response> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Validate the session token via Supabase Auth
  const supabase = createUserClient(token)
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // Look up the tenant for this auth user
  const admin = createAdminClient()
  const { data: tenant } = await admin
    .from('tenants')
    .select('id')
    .eq('auth_id', user.id)
    .single()

  if (!tenant) {
    return new Response(JSON.stringify({ error: 'Account not provisioned' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return { tenantId: tenant.id, userId: user.id }
}

/**
 * Validate a CDT API key (MCP/external agent requests).
 * Returns tenantId on success, null if not an API key request, or 401 Response if invalid.
 */
export async function withApiKey(
  request: Request
): Promise<{ tenantId: string } | Response | null> {
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '')

  // Not an API key request if no header or no cdt_ prefix
  if (!token || !token.startsWith('cdt_')) return null

  const tenantId = await validateApiKey(token)
  if (!tenantId) {
    return new Response(JSON.stringify({ error: 'Invalid API key' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  return { tenantId }
}

/**
 * Combined auth — tries API key first (if cdt_ prefix), then session.
 * Returns auth context on success, or a 401 Response on failure.
 */
export async function withAuth(
  request: Request
): Promise<{ tenantId: string; userId?: string; authMethod: 'session' | 'api_key' } | Response> {
  // Try API key first
  const apiKeyResult = await withApiKey(request)
  if (apiKeyResult instanceof Response) return apiKeyResult
  if (apiKeyResult) {
    return { tenantId: apiKeyResult.tenantId, authMethod: 'api_key' }
  }

  // Fall back to session
  const sessionResult = await withSession(request)
  if (sessionResult instanceof Response) return sessionResult
  return { tenantId: sessionResult.tenantId, userId: sessionResult.userId, authMethod: 'session' }
}
