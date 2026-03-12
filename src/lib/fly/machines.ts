import { createFlyClient } from './client'
import { createAdminClient } from '../../db/supabase'
import { generateMachineJwt } from './jwt'
import { ensureVolume } from './volumes'
import { buildMachineConfig } from './config'
import { FlyApiError, type MachineRecord, type InjectPayload } from './types'

const INJECT_RETRY_DELAY_MS = 2000

/**
 * Ensure a Fly Machine is running for a project.
 * Returns existing running machine, starts stopped machine, or creates new one.
 */
export async function ensureMachineRunning(
  projectId: string,
  tenantId: string,
): Promise<MachineRecord> {
  const supabase = createAdminClient()
  const flyClient = createFlyClient()

  // Check for existing machine
  const { data: machines } = await supabase
    .from('machines')
    .select('*')
    .eq('project_id', projectId)
    .not('status', 'in', '("destroyed","failed")')
    .order('created_at', { ascending: false })
    .limit(1)

  const existing = machines?.[0] as MachineRecord | undefined

  // Case 1: Running machine — return as-is
  if (existing && existing.status === 'running') {
    return existing
  }

  // Case 2: Stopped machine — start it
  if (existing && existing.status === 'stopped' && existing.fly_machine_id) {
    await flyClient.startMachine(existing.fly_machine_id)
    await flyClient.waitForState(existing.fly_machine_id, 'started', 30000)

    await supabase
      .from('machines')
      .update({ status: 'running', updated_at: new Date().toISOString() })
      .eq('id', existing.id)

    return { ...existing, status: 'running' }
  }

  // Case 3: No machine — create new one
  const machineJwt = await generateMachineJwt(projectId, tenantId)
  const volumeId = await ensureVolume(projectId, tenantId)
  const env = await resolveMachineEnv(projectId, tenantId, machineJwt)
  const config = buildMachineConfig({ projectId, tenantId, volumeId, env })

  const flyMachine = await flyClient.createMachine(config)
  await flyClient.waitForState(flyMachine.id, 'started', 60000)

  const appName = process.env.FLY_APP_NAME!

  const { data: inserted } = await supabase
    .from('machines')
    .insert({
      project_id: projectId,
      tenant_id: tenantId,
      fly_machine_id: flyMachine.id,
      fly_app_name: appName,
      status: 'running',
      machine_jwt: machineJwt,
    })
    .select()

  return (inserted?.[0] as MachineRecord) ?? {
    id: 'unknown',
    project_id: projectId,
    tenant_id: tenantId,
    task_id: null,
    fly_machine_id: flyMachine.id,
    fly_app_name: appName,
    status: 'running',
    machine_jwt: machineJwt,
    agents: null,
    cost_summary: null,
  }
}

/**
 * Find a running Machine for a project.
 * Reconciles DB state with Fly API to handle drift.
 */
export async function findMachineForProject(
  projectId: string,
): Promise<MachineRecord | null> {
  const supabase = createAdminClient()
  const flyClient = createFlyClient()

  const { data: machines } = await supabase
    .from('machines')
    .select('*')
    .eq('project_id', projectId)
    .not('status', 'in', '("destroyed","failed")')
    .order('created_at', { ascending: false })
    .limit(1)

  const machine = machines?.[0] as MachineRecord | undefined
  if (!machine || !machine.fly_machine_id) return null

  // Reconcile with Fly API
  try {
    const flyState = await flyClient.getMachine(machine.fly_machine_id)
    const dbStatus = flyStateToDbStatus(flyState.state)

    if (dbStatus !== machine.status) {
      await supabase
        .from('machines')
        .update({ status: dbStatus, updated_at: new Date().toISOString() })
        .eq('id', machine.id)
      machine.status = dbStatus
    }

    if (dbStatus === 'destroyed') return null
    return machine
  } catch {
    // Machine not found in Fly — mark as destroyed
    await supabase
      .from('machines')
      .update({ status: 'destroyed', updated_at: new Date().toISOString() })
      .eq('id', machine.id)
    return null
  }
}

/**
 * Inject a message into a running Machine's broker.
 * Authenticates with the Machine's JWT.
 */
export async function injectMessage(
  machine: MachineRecord,
  payload: InjectPayload,
): Promise<void> {
  const url = `https://${machine.fly_app_name}.fly.dev/api/inject-message`

  async function attempt() {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${machine.machine_jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (response.status === 401 || response.status === 403) {
      throw new FlyApiError(response.status, 'Machine JWT mismatch — unauthorized')
    }

    if (!response.ok) {
      throw new FlyApiError(response.status, `Inject message failed: ${response.status}`)
    }
  }

  try {
    await attempt()
  } catch (err) {
    if (err instanceof FlyApiError && (err.status === 401 || err.status === 403)) {
      throw err // Don't retry auth errors
    }
    // Retry once after delay for transient errors
    await new Promise(resolve => setTimeout(resolve, INJECT_RETRY_DELAY_MS))
    await attempt()
  }
}

/** Resolve env vars for a new Machine (provider keys, GitHub token, JWT, Supabase) */
async function resolveMachineEnv(
  projectId: string,
  tenantId: string,
  machineJwt: string,
): Promise<Record<string, string>> {
  const supabase = createAdminClient()

  // Fetch provider API keys from Vault
  const { data: apiKeys } = await supabase
    .from('tenant_api_keys')
    .select('provider, vault_secret_id')
    .eq('tenant_id', tenantId)

  const env: Record<string, string> = {}
  for (const key of apiKeys ?? []) {
    if (key.vault_secret_id) {
      const { data } = await supabase.rpc('get_secret', { secret_id: key.vault_secret_id })
      if (data) env[`${key.provider.toUpperCase()}_API_KEY`] = data
    }
  }

  // Fetch GitHub token
  const { data: ghConns } = await supabase
    .from('github_connections')
    .select('token_vault_id')
    .eq('tenant_id', tenantId)
    .limit(1)

  if (ghConns?.[0]?.token_vault_id) {
    const { data } = await supabase.rpc('get_secret', { secret_id: ghConns[0].token_vault_id })
    if (data) env.GITHUB_TOKEN = data
  }

  return {
    ...env,
    MACHINE_JWT: machineJwt,
    PROJECT_ID: projectId,
    TENANT_ID: tenantId,
    SUPABASE_URL: process.env.SUPABASE_URL ?? '',
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    CC_MODE: 'cloud',
    NODE_ENV: 'production',
  }
}

function flyStateToDbStatus(flyState: string): string {
  const map: Record<string, string> = {
    created: 'starting',
    starting: 'starting',
    started: 'running',
    stopping: 'stopping',
    stopped: 'stopped',
    destroying: 'destroying',
    destroyed: 'destroyed',
  }
  return map[flyState] ?? flyState
}
