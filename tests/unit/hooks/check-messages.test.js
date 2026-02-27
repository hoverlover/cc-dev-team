import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'

// The hook script is a standalone executable, so we test it by:
// 1. Creating a real SQLite database with test data
// 2. Spawning the script as a child process with the right env vars
// 3. Piping stdin JSON and capturing stdout JSON

import { execFileSync, execSync } from 'child_process'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'

const HOOK_SCRIPT = join(import.meta.dirname, '..', '..', '..', 'hooks', 'check-messages.js')
const TEST_DIR = join(tmpdir(), `check-messages-test-${process.pid}`)
const DB_PATH = join(TEST_DIR, 'data', 'messages.db')

function createTestDb() {
  mkdirSync(join(TEST_DIR, 'data'), { recursive: true })
  const db = new DatabaseSync(DB_PATH)
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      session_id TEXT,
      from_agent TEXT NOT NULL,
      to_agent TEXT NOT NULL,
      thread_id TEXT,
      message_type TEXT NOT NULL,
      content TEXT NOT NULL,
      read INTEGER DEFAULT 0
    )
  `)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent)`)
  db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`)
  return db
}

function insertMessage(db, { from_agent, to_agent, message_type, content, session_id = 'test-session', read = 0 }) {
  db.prepare(`
    INSERT INTO messages (session_id, from_agent, to_agent, message_type, content, read)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(session_id, from_agent, to_agent, message_type, content, read)
}

function runHook(stdinJson, env = {}) {
  const defaultEnv = {
    AGENT_ID: 'engineer-1',
    SESSION_ID: 'test-session',
    ORCHESTRATOR_DIR: TEST_DIR,
    PATH: process.env.PATH,
    HOME: process.env.HOME,
  }
  const result = execFileSync('node', [HOOK_SCRIPT], {
    input: JSON.stringify(stdinJson),
    env: { ...defaultEnv, ...env },
    timeout: 5000,
    encoding: 'utf8',
  })
  return result.trim() ? JSON.parse(result.trim()) : null
}

describe('hooks/check-messages.js', () => {
  let db

  beforeEach(() => {
    mkdirSync('/tmp/cc-dev-team', { recursive: true })
    db = createTestDb()
  })

  afterEach(() => {
    if (db) db.close()
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  describe('PostToolUse - with messages', () => {
    it('delivers unread messages as additionalContext', () => {
      insertMessage(db, {
        from_agent: 'pm',
        to_agent: 'engineer-1',
        message_type: 'TASK_ASSIGNMENT',
        content: 'Implement feature X'
      })

      const result = runHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })

      expect(result).toBeTruthy()
      expect(result.hookSpecificOutput.hookEventName).toBe('PostToolUse')
      expect(result.hookSpecificOutput.additionalContext).toContain('NEW TEAM MESSAGE(S)')
      expect(result.hookSpecificOutput.additionalContext).toContain('[MESSAGE from pm]')
      expect(result.hookSpecificOutput.additionalContext).toContain('[TASK_ASSIGNMENT]')
      expect(result.hookSpecificOutput.additionalContext).toContain('Implement feature X')
    })

    it('marks delivered messages as read', () => {
      insertMessage(db, {
        from_agent: 'pm',
        to_agent: 'engineer-1',
        message_type: 'TASK_ASSIGNMENT',
        content: 'Implement feature X'
      })

      runHook({ hook_event_name: 'PostToolUse', tool_name: 'Read' })

      // Verify message is now marked as read
      const unread = db.prepare('SELECT COUNT(*) as count FROM messages WHERE read = 0').get()
      expect(unread.count).toBe(0)
    })

    it('delivers multiple messages', () => {
      insertMessage(db, {
        from_agent: 'pm',
        to_agent: 'engineer-1',
        message_type: 'TASK_ASSIGNMENT',
        content: 'First task'
      })
      insertMessage(db, {
        from_agent: 'architect',
        to_agent: 'engineer-1',
        message_type: 'DECISION',
        content: 'Use pattern X'
      })

      const result = runHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })

      expect(result.hookSpecificOutput.additionalContext).toContain('[MESSAGE from pm]')
      expect(result.hookSpecificOutput.additionalContext).toContain('[MESSAGE from architect]')
      expect(result.hookSpecificOutput.additionalContext).toContain('First task')
      expect(result.hookSpecificOutput.additionalContext).toContain('Use pattern X')
    })
  })

  describe('PostToolUse - no messages', () => {
    it('returns null when no unread messages', () => {
      const result = runHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })
      expect(result).toBeNull()
    })

    it('ignores already-read messages', () => {
      insertMessage(db, {
        from_agent: 'pm',
        to_agent: 'engineer-1',
        message_type: 'TASK_ASSIGNMENT',
        content: 'Already read',
        read: 1
      })

      const result = runHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })
      expect(result).toBeNull()
    })
  })

  describe('Base role matching', () => {
    it('receives messages sent to base role (engineer)', () => {
      insertMessage(db, {
        from_agent: 'pm',
        to_agent: 'engineer',
        message_type: 'STATUS_UPDATE',
        content: 'Broadcast to all engineers'
      })

      const result = runHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })

      expect(result).toBeTruthy()
      expect(result.hookSpecificOutput.additionalContext).toContain('Broadcast to all engineers')
    })

    it('receives messages sent to team', () => {
      insertMessage(db, {
        from_agent: 'pm',
        to_agent: 'team',
        message_type: 'STATUS_UPDATE',
        content: 'Team announcement'
      })

      const result = runHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })

      expect(result).toBeTruthy()
      expect(result.hookSpecificOutput.additionalContext).toContain('Team announcement')
    })

    it('does not receive messages for other agents', () => {
      insertMessage(db, {
        from_agent: 'pm',
        to_agent: 'architect',
        message_type: 'TASK_ASSIGNMENT',
        content: 'For architect only'
      })

      const result = runHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })
      expect(result).toBeNull()
    })
  })

  describe('Session scoping', () => {
    it('only delivers messages for current session', () => {
      insertMessage(db, {
        from_agent: 'pm',
        to_agent: 'engineer-1',
        message_type: 'TASK_ASSIGNMENT',
        content: 'Wrong session',
        session_id: 'other-session'
      })

      const result = runHook({ hook_event_name: 'PostToolUse', tool_name: 'Bash' })
      expect(result).toBeNull()
    })
  })

  describe('UserPromptSubmit', () => {
    it('delivers messages same as PostToolUse', () => {
      insertMessage(db, {
        from_agent: 'pm',
        to_agent: 'engineer-1',
        message_type: 'FEEDBACK',
        content: 'Fix the tests'
      })

      const result = runHook({ hook_event_name: 'UserPromptSubmit' })

      expect(result).toBeTruthy()
      expect(result.hookSpecificOutput.hookEventName).toBe('UserPromptSubmit')
      expect(result.hookSpecificOutput.additionalContext).toContain('Fix the tests')
    })
  })

  describe('SessionStart', () => {
    it('delivers messages same as PostToolUse', () => {
      insertMessage(db, {
        from_agent: 'pm',
        to_agent: 'engineer-1',
        message_type: 'TASK_ASSIGNMENT',
        content: 'Welcome task'
      })

      const result = runHook({ hook_event_name: 'SessionStart' })

      expect(result).toBeTruthy()
      expect(result.hookSpecificOutput.hookEventName).toBe('SessionStart')
      expect(result.hookSpecificOutput.additionalContext).toContain('Welcome task')
    })
  })

  describe('Stop hook', () => {
    it('blocks and delivers messages in reason field (not additionalContext)', () => {
      insertMessage(db, {
        from_agent: 'pm',
        to_agent: 'engineer-1',
        message_type: 'TASK_ASSIGNMENT',
        content: 'New task while stopping'
      })

      const result = runHook({ hook_event_name: 'Stop' })

      expect(result).toBeTruthy()
      expect(result.decision).toBe('block')
      expect(result.reason).toContain('New team messages received')
      expect(result.reason).toContain('New task while stopping')
      expect(result.reason).toContain('[MESSAGE from pm]')
      expect(result.reason).toContain('[TASK_ASSIGNMENT]')
      expect(result.additionalContext).toBeUndefined()
    })

    it('allows stop when no messages (sub-agent handles waiting)', () => {
      const result = runHook({ hook_event_name: 'Stop' })

      // No messages — allow stop. The parent's foreground Task sub-agent handles message waiting.
      expect(result).toBeNull()
    })
  })

  describe('Agent without number suffix', () => {
    it('works for agents like pm (no base role derivation needed)', () => {
      insertMessage(db, {
        from_agent: 'engineer-1',
        to_agent: 'pm',
        message_type: 'HANDOFF',
        content: 'Ready for review'
      })

      const result = runHook(
        { hook_event_name: 'PostToolUse', tool_name: 'Bash' },
        { AGENT_ID: 'pm' }
      )

      expect(result).toBeTruthy()
      expect(result.hookSpecificOutput.additionalContext).toContain('Ready for review')
    })
  })
})
