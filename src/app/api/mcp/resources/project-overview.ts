import { createAdminClient } from '../../../../db/supabase'
import { McpError, McpErrorCode } from '../errors'

export async function readProjectOverview(projectId: string, tenantId: string) {
  const supabase = createAdminClient()

  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .eq('tenant_id', tenantId)

  const project = projects?.[0]
  if (!project) {
    throw new McpError(McpErrorCode.NOT_FOUND, `Project "${projectId}" not found`)
  }

  // Get latest task info
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, status')
    .eq('project_id', projectId)
    .order('submitted_at', { ascending: false })
    .limit(1)

  // Get machine status
  const { data: machines } = await supabase
    .from('machines')
    .select('status, agents')
    .eq('project_id', projectId)
    .in('status', ['running', 'idle', 'starting'])
    .limit(1)

  return {
    id: project.id,
    name: project.name,
    repo_url: project.repo_url,
    description: project.description,
    status: project.status,
    provider_config: project.provider_config,
    active_task: tasks?.[0] ?? null,
    machine_status: machines?.[0]?.status ?? 'stopped',
    agents_active: machines?.[0]?.agents ?? [],
  }
}
