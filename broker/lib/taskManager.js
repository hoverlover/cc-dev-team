/**
 * Manages task lifecycle in cloud mode — loading from Supabase,
 * assigning to PM via SQLite, completing, failing, and checking the queue.
 */
export class TaskManager {
  constructor({ supabase, db, sessionId }) {
    this.supabase = supabase
    this.db = db
    this.sessionId = sessionId
    this.currentProjectId = null
  }

  /**
   * Load a task from Supabase by ID and mark it as running.
   */
  async loadTask(taskId) {
    const { data: task, error } = await this.supabase
      .from('tasks')
      .select('*, projects(*)')
      .eq('id', taskId)
      .single()

    if (error || !task) {
      throw new Error(`Task ${taskId} not found: ${error?.message || 'no data'}`)
    }

    this.currentProjectId = task.project_id || task.projectId

    // Mark task as running
    await this.supabase
      .from('tasks')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', taskId)

    return task
  }

  /**
   * Mark a task as completed in Supabase.
   */
  async completeTask(taskId, result) {
    await this.supabase
      .from('tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result_summary: result.summary,
        github_pr_url: result.prUrl,
        cost_usd: result.costUsd
      })
      .eq('id', taskId)
  }

  /**
   * Mark a task as failed in Supabase.
   */
  async failTask(taskId, errorMessage) {
    await this.supabase
      .from('tasks')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error: errorMessage
      })
      .eq('id', taskId)
  }

  /**
   * Write a TASK_ASSIGNMENT message to SQLite for the PM agent.
   */
  assignTaskToPm(task) {
    const content = `New task assigned: "${task.title}"\n\nDescription: ${task.description || 'N/A'}\n\nProject: ${task.projects?.name || 'unknown'}\nRepo: ${task.projects?.repo_url || 'N/A'}\nPriority: ${task.priority || 'normal'}`

    this.db.prepare(
      'INSERT INTO messages (session_id, from_agent, to_agent, message_type, content) VALUES (?, ?, ?, ?, ?)'
    ).run(this.sessionId, 'system', 'pm', 'TASK_ASSIGNMENT', content)
  }

  /**
   * Check Supabase for the next queued task for the current project.
   */
  async checkForQueuedTasks() {
    if (!this.currentProjectId) return null

    const { data: nextTask } = await this.supabase
      .from('tasks')
      .select('*')
      .eq('project_id', this.currentProjectId)
      .eq('status', 'queued')
      .order('submitted_at', { ascending: true })
      .limit(1)
      .single()

    return nextTask || null
  }
}
