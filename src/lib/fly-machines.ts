import { createAdminClient } from '../db/supabase'

export interface Machine {
  id: string
  project_id: string
  tenant_id: string
  task_id: string | null
  fly_machine_id: string | null
  fly_app_name: string | null
  status: string
  agents: string[] | null
  cost_summary: Record<string, unknown> | null
}

export interface InjectPayload {
  to: string
  type: string
  content: string
}

/**
 * Find a running Machine for a project.
 * Queries the machines table for active instances.
 */
export async function findMachineForProject(projectId: string): Promise<Machine | null> {
  // TODO: Implement with real Fly.io Machines API (#18)
  // Currently queries Supabase for machine records
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('machines')
    .select('*')
    .eq('project_id', projectId)
    .in('status', ['running', 'idle', 'starting'])
    .order('created_at', { ascending: false })
    .limit(1)

  return (data?.[0] as Machine) || null
}

/**
 * Inject a message into a running Machine's broker.
 * Posts to the Machine's /api/inject-message endpoint.
 */
export async function injectMessage(machine: Machine, message: InjectPayload): Promise<void> {
  // TODO: Implement with real Fly.io machine communication (#18)
  // For now, log the intent - the broker will read queued messages on boot
  console.log(`[fly-machines] Would inject message to ${machine.fly_app_name}:`, message)
}

/**
 * Ensure a Machine is running for a project.
 * Creates, starts, or reuses an existing Machine.
 */
export async function ensureMachineRunning(
  projectId: string,
  tenantId: string
): Promise<Machine> {
  // TODO: Implement with real Fly.io lifecycle management (#18)
  // This stub returns mock data for development
  return {
    id: 'stub-machine-id',
    project_id: projectId,
    tenant_id: tenantId,
    task_id: null,
    fly_machine_id: 'stub-fly-id',
    fly_app_name: 'cdt-stub',
    status: 'starting',
    agents: [],
    cost_summary: null,
  }
}
