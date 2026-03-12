import bcrypt from 'bcryptjs'
import { createAdminClient } from '../../../db/supabase'

export interface AuthContext {
  tenantId: string
}

/**
 * Authenticate a tenant via CDT API key from the Authorization header.
 * Keys follow the format: "Bearer cdt_xxxx..."
 * Lookup by prefix (fast filter), then bcrypt verify.
 */
export async function authenticateTenant(authHeader: string): Promise<AuthContext | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const key = authHeader.slice(7)
  if (!key.startsWith('cdt_')) return null

  const supabase = createAdminClient()

  const prefix = key.substring(0, 8)
  const { data: candidates } = await supabase
    .from('cdt_api_keys')
    .select('id, tenant_id, key_hash')
    .eq('key_prefix', prefix)

  for (const candidate of candidates || []) {
    if (await bcrypt.compare(key, candidate.key_hash)) {
      // Update last_used timestamp (fire-and-forget)
      await supabase
        .from('cdt_api_keys')
        .update({ last_used: new Date().toISOString() })
        .eq('id', candidate.id)

      return { tenantId: candidate.tenant_id }
    }
  }
  return null
}
