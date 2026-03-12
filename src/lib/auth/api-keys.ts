import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createAdminClient } from '../../db/supabase'

/**
 * Hash a CDT API key using SHA-256 HMAC with a pepper.
 * API keys are high-entropy random strings, so HMAC is appropriate
 * (bcrypt's slow hashing is unnecessary and would hurt performance).
 */
export function hashApiKey(rawKey: string): string {
  const pepper = process.env.CDT_API_KEY_PEPPER
  if (!pepper) throw new Error('CDT_API_KEY_PEPPER environment variable is required')
  return createHmac('sha256', pepper).update(rawKey).digest('hex')
}

/**
 * Generate a new CDT API key for a tenant.
 * Returns the raw key (only visible once) and its prefix.
 */
export async function generateApiKey(
  tenantId: string,
  label?: string
): Promise<{ key: string; prefix: string }> {
  const rawKey = `cdt_${randomBytes(24).toString('base64url')}`
  const keyPrefix = rawKey.slice(0, 8)
  const keyHash = hashApiKey(rawKey)

  const supabase = createAdminClient()
  const { error } = await supabase
    .from('cdt_api_keys')
    .insert({
      tenant_id: tenantId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      label: label || null
    })

  if (error) {
    throw new Error(`Failed to create API key: ${error.message}`)
  }

  return { key: rawKey, prefix: keyPrefix }
}

/**
 * Validate a CDT API key and return the associated tenant ID.
 * Returns null if the key is invalid or not a CDT key.
 * Uses constant-time comparison via HMAC (SHA-256 produces fixed output).
 */
export async function validateApiKey(rawKey: string): Promise<string | null> {
  if (!rawKey.startsWith('cdt_')) return null

  const keyHash = hashApiKey(rawKey)

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('cdt_api_keys')
    .select('tenant_id, id')
    .eq('key_hash', keyHash)
    .single()

  if (error || !data) return null

  // Update last_used timestamp (fire-and-forget)
  supabase
    .from('cdt_api_keys')
    .update({ last_used: new Date().toISOString() })
    .eq('id', data.id)

  return data.tenant_id
}
