import {
  type CreateMachineRequest,
  type FlyMachine,
  type CreateVolumeRequest,
  type FlyVolume,
  FlyApiError,
} from './types'

export interface FlyClient {
  createMachine(config: CreateMachineRequest): Promise<FlyMachine>
  getMachine(machineId: string): Promise<FlyMachine>
  startMachine(machineId: string): Promise<void>
  stopMachine(machineId: string): Promise<void>
  destroyMachine(machineId: string): Promise<void>
  listMachines(): Promise<FlyMachine[]>
  waitForState(machineId: string, state: string, timeout?: number, pollInterval?: number): Promise<void>
  createVolume(config: CreateVolumeRequest): Promise<FlyVolume>
  getVolume(volumeId: string): Promise<FlyVolume>
  deleteVolume(volumeId: string): Promise<void>
  listVolumes(): Promise<FlyVolume[]>
}

const MAX_RETRIES = 2
const RETRY_DELAY_MS = 1000

export function createFlyClient(): FlyClient {
  const token = process.env.FLY_API_TOKEN!
  const appName = process.env.FLY_APP_NAME!
  const baseUrl = `https://api.machines.dev/v1/apps/${appName}`

  async function request<T>(
    path: string,
    method: string,
    body?: unknown,
    retries = MAX_RETRIES,
  ): Promise<T> {
    const url = `${baseUrl}${path}`
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    }
    if (body) {
      headers['Content-Type'] = 'application/json'
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      // Retry on 5xx
      if (response.status >= 500 && retries > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS))
        return request<T>(path, method, body, retries - 1)
      }

      const text = await response.text().catch(() => 'Unknown error')
      throw new FlyApiError(response.status, `Fly API ${method} ${path}: ${response.status} ${text}`)
    }

    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      return response.json() as T
    }

    return undefined as T
  }

  return {
    createMachine: (config) => request<FlyMachine>('/machines', 'POST', config),
    getMachine: (machineId) => request<FlyMachine>(`/machines/${machineId}`, 'GET'),
    startMachine: (machineId) => request<void>(`/machines/${machineId}/start`, 'POST'),
    stopMachine: (machineId) => request<void>(`/machines/${machineId}/stop`, 'POST'),
    destroyMachine: (machineId) => request<void>(`/machines/${machineId}`, 'DELETE'),
    listMachines: () => request<FlyMachine[]>('/machines', 'GET'),

    async waitForState(machineId, targetState, timeout = 30000, pollInterval = 1000) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const machine = await this.getMachine(machineId)
        if (machine.state === targetState) return
        await new Promise(resolve => setTimeout(resolve, pollInterval))
      }
      throw new FlyApiError(408, `Timeout waiting for machine ${machineId} to reach state ${targetState}`, machineId)
    },

    createVolume: (config) => request<FlyVolume>('/volumes', 'POST', config),
    getVolume: (volumeId) => request<FlyVolume>(`/volumes/${volumeId}`, 'GET'),
    deleteVolume: (volumeId) => request<void>(`/volumes/${volumeId}`, 'DELETE'),
    listVolumes: () => request<FlyVolume[]>('/volumes', 'GET'),
  }
}
