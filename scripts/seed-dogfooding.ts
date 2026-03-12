#!/usr/bin/env bun
/**
 * Seed script for dogfooding environment.
 *
 * Creates tenant, project, CDT API key (with real bcrypt hash),
 * and optionally stores a test provider API key in Vault.
 *
 * Usage: bun run scripts/seed-dogfooding.ts
 */

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

if (!SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const PROJECT_ID = '00000000-0000-0000-0000-000000000002'

async function main() {
  // Generate a real CDT API key
  const rawKey = `cdt_${randomBytes(24).toString('base64url')}`
  const keyPrefix = rawKey.slice(0, 8)
  const keyHash = await Bun.password.hash(rawKey, { algorithm: 'bcrypt', cost: 10 })

  // Upsert tenant
  const { error: tenantErr } = await supabase
    .from('tenants')
    .upsert({
      id: TENANT_ID,
      name: 'cc-dev-team-ops',
      email: 'operator@example.com',
      plan: 'pro',
    }, { onConflict: 'id' })

  if (tenantErr) {
    console.error('Failed to upsert tenant:', tenantErr.message)
    process.exit(1)
  }

  // Upsert project
  const { error: projectErr } = await supabase
    .from('projects')
    .upsert({
      id: PROJECT_ID,
      tenant_id: TENANT_ID,
      name: 'cc-dev-team',
      repo_url: 'https://github.com/hoverlover/cc-dev-team',
      description: 'The orchestrator itself — dogfooding',
    }, { onConflict: 'id' })

  if (projectErr) {
    console.error('Failed to upsert project:', projectErr.message)
    process.exit(1)
  }

  // Insert CDT API key
  const { error: keyErr } = await supabase
    .from('cdt_api_keys')
    .insert({
      tenant_id: TENANT_ID,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      label: 'Dogfooding key',
    })

  if (keyErr) {
    console.error('Failed to insert CDT API key:', keyErr.message)
    process.exit(1)
  }

  // Optionally store a test provider API key in Vault
  const testProviderKey = process.env.TEST_PROVIDER_API_KEY
  if (testProviderKey) {
    const { data: vaultData, error: vaultErr } = await supabase
      .rpc('store_secret', {
        secret_value: testProviderKey,
        secret_name: `tenant:${TENANT_ID}:provider:test`,
      })

    if (vaultErr) {
      console.error('Failed to store test provider key in Vault:', vaultErr.message)
    } else {
      const { error: apiKeyErr } = await supabase
        .from('tenant_api_keys')
        .insert({
          tenant_id: TENANT_ID,
          provider: 'test',
          vault_secret_id: vaultData,
          label: 'Test provider key',
          is_default: true,
        })

      if (apiKeyErr) {
        console.error('Failed to insert provider API key record:', apiKeyErr.message)
      } else {
        console.log('Test provider API key stored in Vault')
      }
    }
  }

  console.log('\nDogfooding seed complete!')
  console.log(`Tenant ID: ${TENANT_ID}`)
  console.log(`Project ID: ${PROJECT_ID}`)
  console.log(`\nCDT API Key (save this — it won't be shown again):`)
  console.log(`  ${rawKey}`)
}

main()
