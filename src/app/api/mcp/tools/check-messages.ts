import { createAdminClient } from '../../../../db/supabase'
import { McpError, McpErrorCode } from '../errors'

interface CheckMessagesInput {
  tenantId: string
  project?: string
  unread_only?: boolean
}

export async function handleCheckMessages(input: CheckMessagesInput) {
  const supabase = createAdminClient()
  const unreadOnly = input.unread_only ?? true

  // If project filter specified, resolve to project ID
  let projectId: string | null = null
  if (input.project) {
    const { data: projects } = await supabase
      .from('projects')
      .select('id')
      .eq('name', input.project)
      .eq('tenant_id', input.tenantId)

    if (!projects?.[0]) {
      throw new McpError(McpErrorCode.NOT_FOUND, `Project "${input.project}" not found`)
    }
    projectId = projects[0].id
  }

  // Build query for pm_outbox joined with task info
  let query = supabase
    .from('pm_outbox')
    .select('id, task_id, type, content, requires_response, response, created_at, read_at, tasks!inner(project_id, projects!inner(name))')
    .eq('tenant_id', input.tenantId)

  if (projectId) {
    query = query.eq('tasks.project_id', projectId)
  }

  if (unreadOnly) {
    query = query.is('read_at', null)
  }

  const { data: messages } = await query.order('created_at', { ascending: false })

  // Mark returned unread messages as read
  if (unreadOnly && messages?.length) {
    const ids = messages.map((m: any) => m.id)
    for (const id of ids) {
      await supabase
        .from('pm_outbox')
        .update({ read_at: new Date().toISOString() })
        .eq('id', id)
    }
  }

  return {
    messages: (messages || []).map((m: any) => ({
      id: m.id,
      task_id: m.task_id,
      project_name: m.tasks?.projects?.name ?? 'unknown',
      type: m.type,
      content: m.content,
      requires_response: m.requires_response,
      response: m.response,
      created_at: m.created_at,
      read_at: m.read_at,
    })),
  }
}
