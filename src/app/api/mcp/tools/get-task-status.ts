import { createAdminClient } from '../../../../db/supabase'
import { McpError, McpErrorCode } from '../errors'

interface GetTaskStatusInput {
  tenantId: string
  task_id: string
}

export async function handleGetTaskStatus(input: GetTaskStatusInput) {
  const supabase = createAdminClient()

  // Query task, enforce tenant isolation
  const { data: tasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', input.task_id)
    .eq('tenant_id', input.tenantId)

  const task = tasks?.[0]
  if (!task) {
    throw new McpError(McpErrorCode.NOT_FOUND, `Task "${input.task_id}" not found`)
  }

  // Query active machine for agent info
  const { data: machines } = await supabase
    .from('machines')
    .select('agents')
    .eq('project_id', task.project_id)
    .in('status', ['running', 'idle', 'starting'])
    .order('created_at', { ascending: false })
    .limit(1)

  // Query unresponded blockers
  const { data: blockerRows } = await supabase
    .from('pm_outbox')
    .select('content')
    .eq('task_id', task.id)
    .eq('requires_response', true)
    .is('response', null)

  const agents = machines?.[0]?.agents
  const blockers = blockerRows?.length ? blockerRows.map((b: any) => b.content) : null

  return {
    status: task.status,
    title: task.title,
    summary: task.result_summary ?? null,
    agents_active: Array.isArray(agents) ? agents : [],
    current_phase: task.status, // Derived from status for now
    pr_url: task.github_pr_url ?? null,
    blockers,
    cost: task.cost_tokens
      ? { tokens: task.cost_tokens, usd: parseFloat(task.cost_usd ?? '0') }
      : null,
  }
}
