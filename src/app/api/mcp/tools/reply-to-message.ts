import { createAdminClient } from '../../../../db/supabase'
import { findMachineForProject, injectMessage } from '../../../../lib/fly/machines'
import { McpError, McpErrorCode } from '../errors'

interface ReplyToMessageInput {
  tenantId: string
  message_id: string
  response: string
}

export async function handleReplyToMessage(input: ReplyToMessageInput) {
  const supabase = createAdminClient()

  // Fetch pm_outbox row, verify tenant owns it
  const { data: rows } = await supabase
    .from('pm_outbox')
    .select('id, tenant_id, task_id, requires_response, response')
    .eq('id', input.message_id)
    .eq('tenant_id', input.tenantId)

  const message = rows?.[0]
  if (!message) {
    throw new McpError(McpErrorCode.NOT_FOUND, `Message "${input.message_id}" not found`)
  }

  // Guard: must require response and not already replied
  if (!message.requires_response) {
    throw new McpError(McpErrorCode.CONFLICT, 'Message does not require a response')
  }
  if (message.response !== null) {
    throw new McpError(McpErrorCode.CONFLICT, 'Already responded to this message')
  }

  // Store the response
  await supabase
    .from('pm_outbox')
    .update({
      response: input.response,
      responded_at: new Date().toISOString(),
    })
    .eq('id', message.id)

  // Find the task to get project_id
  const { data: taskRows } = await supabase
    .from('tasks')
    .select('id, project_id')
    .eq('id', message.task_id)

  const task = taskRows?.[0]
  if (!task) {
    return { ok: true, note: 'Response stored but task not found' }
  }

  // Try to inject into running machine
  const machine = await findMachineForProject(task.project_id)
  if (machine) {
    await injectMessage(machine, {
      to: 'pm',
      type: 'HUMAN_RESPONSE',
      content: input.response,
    })
    return { ok: true }
  }

  return { ok: true, note: 'Machine unavailable, response queued for next startup' }
}
