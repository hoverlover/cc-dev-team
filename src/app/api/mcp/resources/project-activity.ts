import { createAdminClient } from '../../../../db/supabase'
import { McpError, McpErrorCode } from '../errors'

export async function readProjectActivity(projectId: string, tenantId: string) {
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

  // Get recent tasks
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, title, status, submitted_at, completed_at')
    .eq('project_id', projectId)
    .order('submitted_at', { ascending: false })
    .limit(20)

  // Get recent PM outbox messages
  const { data: messages } = await supabase
    .from('pm_outbox')
    .select('id, type, content, created_at, task_id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(20)

  // Filter messages to those belonging to tasks in this project
  const taskIds = new Set((tasks ?? []).map((t: any) => t.id))
  const projectMessages = (messages ?? []).filter((m: any) => taskIds.has(m.task_id))

  // Merge and sort by timestamp
  const events = [
    ...(tasks ?? []).map((t: any) => ({
      type: 'task',
      id: t.id,
      title: t.title,
      status: t.status,
      timestamp: t.submitted_at,
    })),
    ...projectMessages.map((m: any) => ({
      type: 'message',
      id: m.id,
      message_type: m.type,
      content: m.content,
      task_id: m.task_id,
      timestamp: m.created_at,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 20)

  return { events }
}
