import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { execFile } from 'child_process'
import { join } from 'path'
import { mkdirSync, rmSync, existsSync, unlinkSync, openSync, writeSync, closeSync } from 'fs'
import { tmpdir } from 'os'

const POLLER_SCRIPT = join(import.meta.dirname, '..', '..', '..', 'tools', 'wait-for-messages.js')
const TEST_DIR = join(tmpdir(), `wait-for-messages-test-${process.pid}`)
const DB_PATH = join(TEST_DIR, 'data', 'messages.db')
const TEST_SESSION_ID = 'test-session'
const TEMP_DIR = '/tmp/cc-dev-team'
const LOCK_FILE = `${TEMP_DIR}/cc-poller-engineer-1-${TEST_SESSION_ID}.lock`
const FIFO_PATH = `${TEMP_DIR}/cc-wake-engineer-1-${TEST_SESSION_ID}`

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
  return db
}

function insertMessage(db, { from_agent, to_agent, message_type, content, session_id = 'test-session' }) {
  db.prepare(`
    INSERT INTO messages (session_id, from_agent, to_agent, message_type, content)
    VALUES (?, ?, ?, ?, ?)
  `).run(session_id, from_agent, to_agent, message_type, content)
}

function cleanupLockAndFifo() {
  try { unlinkSync(LOCK_FILE) } catch { /* ignore */ }
  try { unlinkSync(FIFO_PATH) } catch { /* ignore */ }
}

// Write to the FIFO to wake up the poller (simulates what the broker does)
function wakeFifo() {
  try {
    // O_WRONLY | O_NONBLOCK = open for writing, fail if no reader
    const fd = openSync(FIFO_PATH, 'w')
    writeSync(fd, 'wake\n')
    closeSync(fd)
  } catch {
    // FIFO not ready yet — ignore
  }
}

describe('tools/wait-for-messages.js', () => {
  let db

  beforeEach(() => {
    cleanupLockAndFifo()
    db = createTestDb()
  })

  afterEach(() => {
    if (db) db.close()
    cleanupLockAndFifo()
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  it('exits immediately when messages already exist', async () => {
    insertMessage(db, {
      from_agent: 'pm',
      to_agent: 'engineer-1',
      message_type: 'TASK_ASSIGNMENT',
      content: 'Do this'
    })

    const result = await new Promise((resolve, reject) => {
      execFile('node', [
        POLLER_SCRIPT,
        '--agent', 'engineer-1',
        '--session', 'test-session',
        '--timeout', '5'
      ], {
        env: {
          ...process.env,
          ORCHESTRATOR_DIR: TEST_DIR,
          AGENT_ID: 'engineer-1',
          SESSION_ID: 'test-session'
        },
        timeout: 10000
      }, (err, stdout, stderr) => {
        resolve({ code: err?.code ?? 0, stdout: stdout.trim(), stderr })
      })
    })

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Messages pending for engineer-1')
  })

  // FIFO mode no longer has a timeout — it blocks indefinitely until
  // the broker writes to it. The "wakes up when FIFO is written to" test
  // below validates this blocking behavior.

  it('wakes up when FIFO is written to', async () => {
    // Start poller (no messages in DB), then write to FIFO after a delay
    const result = await new Promise((resolve) => {
      const child = execFile('node', [
        POLLER_SCRIPT,
        '--agent', 'engineer-1',
        '--session', 'test-session',
        '--timeout', '10'
      ], {
        env: {
          ...process.env,
          ORCHESTRATOR_DIR: TEST_DIR,
          AGENT_ID: 'engineer-1',
          SESSION_ID: 'test-session'
        },
        timeout: 15000
      }, (err, stdout) => {
        resolve({ code: err?.code ?? 0, stdout: stdout.trim() })
      })

      // Give the poller time to create the FIFO and start blocking on it
      setTimeout(() => {
        // Insert a message first (so the hook will find it after wake-up)
        insertMessage(db, {
          from_agent: 'pm',
          to_agent: 'engineer-1',
          message_type: 'TASK_ASSIGNMENT',
          content: 'Delayed task'
        })
        // Then wake the FIFO (simulates broker behavior)
        wakeFifo()
      }, 1000)
    })

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Messages pending for engineer-1')
  })

  it('receives messages sent to base role', async () => {
    insertMessage(db, {
      from_agent: 'pm',
      to_agent: 'engineer',
      message_type: 'STATUS_UPDATE',
      content: 'Broadcast'
    })

    const result = await new Promise((resolve) => {
      execFile('node', [
        POLLER_SCRIPT,
        '--agent', 'engineer-1',
        '--session', 'test-session',
        '--timeout', '3'
      ], {
        env: {
          ...process.env,
          ORCHESTRATOR_DIR: TEST_DIR,
          AGENT_ID: 'engineer-1',
          SESSION_ID: 'test-session'
        },
        timeout: 10000
      }, (err, stdout) => {
        resolve({ code: err?.code ?? 0, stdout: stdout.trim() })
      })
    })

    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Messages pending')
  })
})
