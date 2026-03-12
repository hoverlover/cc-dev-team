/**
 * Bridges PM-to-human messages from local SQLite to Supabase pm_outbox.
 * Detects messages where to_agent='human' and posts them to the cloud outbox.
 */
export class OutboxPoster {
  constructor({ supabase, taskId, tenantId }) {
    this.supabase = supabase
    this.taskId = taskId
    this.tenantId = tenantId
  }

  /** Types that require a human response */
  static RESPONSE_TYPES = new Set(['HUMAN_QUESTION', 'APPROVAL_REQUEST'])

  /**
   * Check if a message should be posted to the outbox.
   * Only messages directed at 'human' are outbox-bound.
   */
  shouldPost(message) {
    return message.to_agent === 'human'
  }

  /**
   * Post a message to the Supabase pm_outbox table.
   */
  async post(message) {
    const requiresResponse = OutboxPoster.RESPONSE_TYPES.has(message.message_type)

    const { error } = await this.supabase
      .from('pm_outbox')
      .insert({
        task_id: this.taskId,
        tenant_id: this.tenantId,
        type: message.message_type,
        content: message.content,
        requires_response: requiresResponse
      })

    if (error) {
      console.error(`[OutboxPoster] Failed to post to outbox:`, error.message)
    }
  }
}
