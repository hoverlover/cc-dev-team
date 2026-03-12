/** Fly Machines REST API types */

export interface CreateMachineRequest {
  name?: string
  region?: string
  config: {
    image: string
    env: Record<string, string>
    guest: { cpu_kind: string; cpus: number; memory_mb: number }
    auto_destroy: boolean
    restart: { policy: string }
    services: Array<{
      ports: Array<{ port: number; handlers: string[] }>
      protocol: string
      internal_port: number
    }>
    checks: Record<string, {
      type: string
      port: number
      path: string
      interval: string
      timeout: string
    }>
    mounts: Array<{
      volume: string
      path: string
    }>
    stop_config: {
      timeout: string
      signal: string
    }
  }
}

export type FlyMachineState =
  | 'created'
  | 'starting'
  | 'started'
  | 'stopping'
  | 'stopped'
  | 'destroying'
  | 'destroyed'

export interface FlyMachine {
  id: string
  name: string
  state: FlyMachineState
  region: string
  config: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface CreateVolumeRequest {
  name: string
  size_gb: number
  region: string
}

export interface FlyVolume {
  id: string
  name: string
  size_gb: number
  region: string
  state: string
  created_at: string
}

export interface InjectPayload {
  type: 'HUMAN_RESPONSE' | 'TASK_ASSIGNMENT' | 'CANCEL'
  taskId: string
  content: string
  from?: string
}

export interface MachineRecord {
  id: string
  project_id: string
  tenant_id: string
  task_id: string | null
  fly_machine_id: string | null
  fly_app_name: string | null
  status: string
  machine_jwt: string | null
  agents: string[] | null
  cost_summary: Record<string, unknown> | null
}

export class FlyApiError extends Error {
  status: number
  machineId?: string

  constructor(status: number, message: string, machineId?: string) {
    super(message)
    this.name = 'FlyApiError'
    this.status = status
    this.machineId = machineId
  }
}
