import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OutboxPoster } from '../../../broker/lib/outboxPoster.js'

describe('OutboxPoster', () => {
  let mockSupabase
  let poster

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn(() => mockSupabase),
      insert: vi.fn(() => ({ error: null }))
    }

    poster = new OutboxPoster({
      supabase: mockSupabase,
      taskId: 'task-abc',
      tenantId: 'tenant-xyz'
    })
  })

  describe('shouldPost', () => {
    it('returns true for messages to human', () => {
      expect(poster.shouldPost({ to_agent: 'human', message_type: 'STATUS_UPDATE' })).toBe(true)
    })

    it('returns false for agent-to-agent messages', () => {
      expect(poster.shouldPost({ to_agent: 'engineer', message_type: 'TASK_ASSIGNMENT' })).toBe(false)
    })

    it('returns false for messages to team', () => {
      expect(poster.shouldPost({ to_agent: 'team', message_type: 'STATUS_UPDATE' })).toBe(false)
    })
  })

  describe('post', () => {
    it('posts message to Supabase pm_outbox', async () => {
      await poster.post({
        message_type: 'HUMAN_QUESTION',
        content: 'Should we use REST or GraphQL?'
      })

      expect(mockSupabase.from).toHaveBeenCalledWith('pm_outbox')
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          task_id: 'task-abc',
          tenant_id: 'tenant-xyz',
          type: 'HUMAN_QUESTION',
          content: 'Should we use REST or GraphQL?'
        })
      )
    })

    it('sets requires_response for HUMAN_QUESTION', async () => {
      await poster.post({
        message_type: 'HUMAN_QUESTION',
        content: 'Question?'
      })

      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({ requires_response: true })
      )
    })

    it('sets requires_response for APPROVAL_REQUEST', async () => {
      await poster.post({
        message_type: 'APPROVAL_REQUEST',
        content: 'Please approve'
      })

      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({ requires_response: true })
      )
    })

    it('does not set requires_response for STATUS_UPDATE', async () => {
      await poster.post({
        message_type: 'STATUS_UPDATE',
        content: 'Progress update'
      })

      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({ requires_response: false })
      )
    })
  })
})
