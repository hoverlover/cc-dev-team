import type { CreateMachineRequest } from './types'

const DEFAULT_IMAGE = 'registry.fly.io/cdt-machines:latest'
const DEFAULT_REGION = 'iad'

/**
 * Build a Fly Machine config for a project.
 * See Fly Machines API docs for config structure.
 */
export function buildMachineConfig(params: {
  projectId: string
  tenantId: string
  volumeId: string
  env: Record<string, string>
}): CreateMachineRequest {
  const shortTenant = params.tenantId.substring(0, 8)
  const shortProject = params.projectId.substring(0, 8)

  return {
    name: `cdt-${shortTenant}-${shortProject}`,
    region: DEFAULT_REGION,
    config: {
      image: DEFAULT_IMAGE,
      env: params.env,
      guest: {
        cpu_kind: 'shared',
        cpus: 1,
        memory_mb: 1024,
      },
      auto_destroy: false,
      restart: { policy: 'on-failure' },
      services: [
        {
          ports: [{ port: 443, handlers: ['tls', 'http'] }],
          protocol: 'tcp',
          internal_port: 8080,
        },
      ],
      checks: {
        health: {
          type: 'http',
          port: 8080,
          path: '/health',
          interval: '30s',
          timeout: '5s',
        },
      },
      mounts: [
        {
          volume: params.volumeId,
          path: '/data',
        },
      ],
      stop_config: {
        timeout: '10s',
        signal: 'SIGTERM',
      },
    },
  }
}
