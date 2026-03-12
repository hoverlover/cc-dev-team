import { createAdminClient } from '../../../../db/supabase'
import { McpError, McpErrorCode } from '../errors'

export async function readProjectTasks(projectId: string, tenantId: string) {
  const supabase = createAdminClient()

  // Verify tenant owns project
  const { data: projects } = await supabase
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('tenant_id', tenantId)

  if (!projects?.[0]) {
    throw new McpError(McpErrorCode.NOT_FOUND, `Project "${projectId}" not found`)
  }

  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('project_id', projectId)
    .order('submitted_at', { ascending: false })

  return {
    tasks: (tasks ?? []).map((t: any) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      submitted_at: t.submitted_at,
      started_at: t.started_at,
      completed_at: t.completed_at,
      pr_url: t.github_pr_url,
      issue_url: t.github_issue_url,
      cost: t.cost_tokens
        ? { tokens: t.cost_tokens, usd: parseFloat(t.cost_usd ?? '0') }
        : null,
    })),
  }
}
