import { createAdminClient } from '../../../../db/supabase'
import { ensureMachineRunning } from '../../../../lib/fly-machines'
import { McpError, McpErrorCode } from '../errors'

interface SubmitTaskInput {
  tenantId: string
  project: string
  title: string
  description: string
  priority?: 'low' | 'normal' | 'high'
  provider_config?: Record<string, { provider: string; model: string }>
}

const PRIORITY_MAP: Record<string, number> = {
  low: 0,
  normal: 1,
  high: 2,
}

export async function handleSubmitTask(input: SubmitTaskInput) {
  const supabase = createAdminClient()

  // Resolve project by name, verify tenant owns it
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name')
    .eq('name', input.project)
    .eq('tenant_id', input.tenantId)

  const project = projects?.[0]
  if (!project) {
    throw new McpError(McpErrorCode.NOT_FOUND, `Project "${input.project}" not found`)
  }

  // Insert task
  const priority = PRIORITY_MAP[input.priority ?? 'normal'] ?? 1
  const { data: tasks, error } = await supabase
    .from('tasks')
    .insert({
      project_id: project.id,
      tenant_id: input.tenantId,
      title: input.title,
      description: input.description,
      priority,
      status: 'queued',
      metadata: input.provider_config ? { provider_config: input.provider_config } : null,
    })
    .select()

  if (error || !tasks?.[0]) {
    throw new McpError(McpErrorCode.SERVICE_UNAVAILABLE, 'Failed to create task')
  }

  const task = tasks[0]

  // Try to ensure a Machine is running (best-effort)
  try {
    await ensureMachineRunning(project.id, input.tenantId)
    return { task_id: task.id, status: task.status ?? 'queued' }
  } catch {
    // Machine creation failed, task stays queued
    return { task_id: task.id, status: 'queued' }
  }
}
