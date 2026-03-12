/**
 * RLS (Row Level Security) verification tests.
 *
 * These are integration tests that require a running Supabase local instance:
 *   supabase start
 *   supabase db reset  (applies migrations + seed)
 *
 * Run with: bun test:run tests/db/rls.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const ANON_KEY = process.env.SUPABASE_ANON_KEY ?? ''
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// Skip entire suite if Supabase is not running
const supabaseAvailable = ANON_KEY && SERVICE_ROLE_KEY
const describeIf = supabaseAvailable ? describe : describe.skip

describeIf('RLS tenant isolation', () => {
  let serviceClient: SupabaseClient
  let userAClient: SupabaseClient
  let userBClient: SupabaseClient
  let tenantAId: string
  let tenantBId: string
  let projectAId: string

  beforeAll(async () => {
    serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    // Create two test users via Supabase Auth admin API
    const { data: userA } = await serviceClient.auth.admin.createUser({
      email: 'test-user-a@example.com',
      password: 'test-password-a',
      email_confirm: true,
    })
    const { data: userB } = await serviceClient.auth.admin.createUser({
      email: 'test-user-b@example.com',
      password: 'test-password-b',
      email_confirm: true,
    })

    if (!userA.user || !userB.user) {
      throw new Error('Failed to create test users')
    }

    // Sign in as each user to get access tokens
    const anonClient = createClient(SUPABASE_URL, ANON_KEY)

    const { data: sessionA } = await anonClient.auth.signInWithPassword({
      email: 'test-user-a@example.com',
      password: 'test-password-a',
    })
    const { data: sessionB } = await anonClient.auth.signInWithPassword({
      email: 'test-user-b@example.com',
      password: 'test-password-b',
    })

    if (!sessionA.session || !sessionB.session) {
      throw new Error('Failed to sign in test users')
    }

    userAClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${sessionA.session.access_token}` } },
    })
    userBClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${sessionB.session.access_token}` } },
    })

    // Create tenants for each user (via service role to set auth_id)
    const { data: tA } = await serviceClient
      .from('tenants')
      .insert({ auth_id: userA.user.id, name: 'Tenant A', email: 'a@test.com' })
      .select('id')
      .single()
    const { data: tB } = await serviceClient
      .from('tenants')
      .insert({ auth_id: userB.user.id, name: 'Tenant B', email: 'b@test.com' })
      .select('id')
      .single()

    tenantAId = tA!.id
    tenantBId = tB!.id

    // Create test data for Tenant A
    const { data: pA } = await serviceClient
      .from('projects')
      .insert({ tenant_id: tenantAId, name: 'Project A' })
      .select('id')
      .single()
    projectAId = pA!.id

    const { data: taskA } = await serviceClient
      .from('tasks')
      .insert({ project_id: projectAId, tenant_id: tenantAId, title: 'Task A' })
      .select('id')
      .single()

    await serviceClient.from('pm_outbox').insert({
      task_id: taskA!.id, tenant_id: tenantAId, type: 'info', content: 'Test message',
    })

    await serviceClient.from('tenant_api_keys').insert({
      tenant_id: tenantAId, provider: 'openai', label: 'Test key',
    })

    await serviceClient.from('github_connections').insert({
      tenant_id: tenantAId, github_user_id: '12345', github_username: 'testuser-a',
    })

    await serviceClient.from('machines').insert({
      project_id: projectAId, tenant_id: tenantAId, fly_machine_id: 'mach-a',
    })

    await serviceClient.from('cdt_api_keys').insert({
      tenant_id: tenantAId, key_hash: '$2b$10$test', key_prefix: 'cdt_test', label: 'Test',
    })

    // Create minimal data for Tenant B
    const { data: pB } = await serviceClient
      .from('projects')
      .insert({ tenant_id: tenantBId, name: 'Project B' })
      .select('id')
      .single()

    await serviceClient.from('tasks').insert({
      project_id: pB!.id, tenant_id: tenantBId, title: 'Task B',
    })
  })

  const tables = [
    'tenants',
    'projects',
    'tasks',
    'pm_outbox',
    'tenant_api_keys',
    'github_connections',
    'machines',
    'cdt_api_keys',
  ] as const

  for (const table of tables) {
    it(`Tenant A cannot see Tenant B's ${table}`, async () => {
      const { data } = await userAClient.from(table).select('*')
      const ids = (data ?? []).map((r: Record<string, unknown>) =>
        'tenant_id' in r ? r.tenant_id : r.id
      )
      // None of User A's visible rows should belong to Tenant B
      expect(ids).not.toContain(tenantBId)
    })

    it(`Tenant B cannot see Tenant A's ${table}`, async () => {
      const { data } = await userBClient.from(table).select('*')
      const ids = (data ?? []).map((r: Record<string, unknown>) =>
        'tenant_id' in r ? r.tenant_id : r.id
      )
      expect(ids).not.toContain(tenantAId)
    })
  }

  it('Service role CAN see all data (bypasses RLS)', async () => {
    const { data: allTenants } = await serviceClient.from('tenants').select('id')
    const tenantIds = (allTenants ?? []).map((t: { id: string }) => t.id)
    expect(tenantIds).toContain(tenantAId)
    expect(tenantIds).toContain(tenantBId)
  })
})
