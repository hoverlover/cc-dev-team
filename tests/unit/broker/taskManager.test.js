import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TaskManager } from '../../../broker/lib/taskManager.js'

describe('TaskManager', () => {
  let mockSupabase
  let mockDb
  let tm

  beforeEach(() => {
    mockSupabase = {
      from: vi.fn(() => mockSupabase),
      select: vi.fn(() => mockSupabase),
      update: vi.fn(() => mockSupabase),
      insert: vi.fn(() => mockSupabase),
      eq: vi.fn(() => mockSupabase),
      order: vi.fn(() => mockSupabase),
      limit: vi.fn(() => mockSupabase),
      single: vi.fn(() => ({
        data: {
          id: 'task-abc',
          title: 'Build auth flow',
          description: 'Implement OAuth',
          status: 'queued',
          projects: { name: 'my-project', repo_url: 'https://github.com/test/repo' },
          priority: 1,
          tenant_id: 'tenant-xyz'
        },
        error: null
      }))
    }

    mockDb = {
      prepare: vi.fn(() => ({
        run: vi.fn(() => ({ lastInsertRowid: 1 }))
      }))
    }

    tm = new TaskManager({ supabase: mockSupabase, db: mockDb, sessionId: 'session-1' })
  })

  describe('loadTask', () => {
    it('fetches task from Supabase by ID', async () => {
      const task = await tm.loadTask('task-abc')

      expect(mockSupabase.from).toHaveBeenCalledWith('tasks')
      expect(mockSupabase.select).toHaveBeenCalledWith('*, projects(*)')
      expect(mockSupabase.eq).toHaveBeenCalledWith('id', 'task-abc')
      expect(task.id).toBe('task-abc')
    })

    it('updates task status to running', async () => {
      await tm.loadTask('task-abc')

      // Should call update with status='running'
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'running' })
      )
    })

    it('throws when task not found', async () => {
      mockSupabase.single = vi.fn(() => ({ data: null, error: { message: 'not found' } }))

      await expect(tm.loadTask('nonexistent')).rejects.toThrow()
    })
  })

  describe('completeTask', () => {
    it('updates task to completed in Supabase', async () => {
      await tm.completeTask('task-abc', {
        summary: 'Auth flow implemented',
        prUrl: 'https://github.com/test/repo/pull/1',
        costUsd: 0.50
      })

      expect(mockSupabase.from).toHaveBeenCalledWith('tasks')
      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          result_summary: 'Auth flow implemented',
          github_pr_url: 'https://github.com/test/repo/pull/1'
        })
      )
    })
  })

  describe('failTask', () => {
    it('updates task to failed in Supabase', async () => {
      await tm.failTask('task-abc', 'Exceeded max duration')

      expect(mockSupabase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error: 'Exceeded max duration'
        })
      )
    })
  })

  describe('assignTaskToPm', () => {
    it('writes TASK_ASSIGNMENT message to SQLite', () => {
      const task = {
        title: 'Build auth flow',
        description: 'Implement OAuth',
        projects: { name: 'my-project', repo_url: 'https://github.com/test/repo' },
        priority: 1
      }

      tm.assignTaskToPm(task)

      expect(mockDb.prepare).toHaveBeenCalled()
      const runCall = mockDb.prepare.mock.results[0].value.run
      expect(runCall).toHaveBeenCalledWith(
        'session-1',
        'system',
        'pm',
        'TASK_ASSIGNMENT',
        expect.stringContaining('Build auth flow')
      )
    })
  })

  describe('checkForQueuedTasks', () => {
    it('returns next queued task if available', async () => {
      tm.currentProjectId = 'project-1'
      mockSupabase.single = vi.fn(() => ({
        data: { id: 'task-next', title: 'Next task', status: 'queued' },
        error: null
      }))

      const next = await tm.checkForQueuedTasks()

      expect(mockSupabase.from).toHaveBeenCalledWith('tasks')
      expect(mockSupabase.eq).toHaveBeenCalledWith('status', 'queued')
      expect(next).toBeTruthy()
      expect(next.id).toBe('task-next')
    })

    it('returns null when no queued tasks', async () => {
      tm.currentProjectId = 'project-1'
      mockSupabase.single = vi.fn(() => ({ data: null, error: null }))

      const next = await tm.checkForQueuedTasks()

      expect(next).toBeNull()
    })
  })
})
