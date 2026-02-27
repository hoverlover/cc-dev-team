#!/usr/bin/env node
/**
 * Hook script: check-messages.js
 *
 * Queries SQLite for unread team messages and injects them into Claude's context
 * via hook JSON output. Runs on PostToolUse, UserPromptSubmit, SessionStart, and Stop.
 *
 * Hook input uses snake_case field names (e.g., hook_event_name, tool_name).
 * Hook output uses camelCase field names (e.g., hookEventName, additionalContext).
 *
 * Environment variables:
 *   AGENT_ID            - This agent's ID (e.g., "engineer-1")
 *   BROKER_SESSION_ID   - Broker's stable session ID (preferred)
 *   SESSION_ID          - Fallback session ID (may change on /resume)
 *   ORCHESTRATOR_DIR - Path to orchestrator root (contains data/messages.db)
 */

// Suppress Node.js ExperimentalWarning (SQLite) to keep hook output clean
const _origEmit = process.emit
process.emit = function (event, ...args) {
  if (event === 'warning' && args[0]?.name === 'ExperimentalWarning') return false
  return _origEmit.call(this, event, ...args)
}

import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const agentId = process.env.AGENT_ID
const sessionId = process.env.BROKER_SESSION_ID || process.env.SESSION_ID
const orchestratorDir = process.env.ORCHESTRATOR_DIR

if (!agentId || !sessionId || !orchestratorDir) {
  process.exit(0) // Missing env — silently skip (not an error for hooks)
}

// Read stdin JSON (hook input)
let hookInput
try {
  const chunks = []
  for await (const chunk of process.stdin) {
    chunks.push(chunk)
  }
  hookInput = JSON.parse(Buffer.concat(chunks).toString())
} catch {
  process.exit(0) // Invalid input — silently skip
}

// Hook input uses snake_case field names
const hookEvent = hookInput.hook_event_name

// Derive base role for broadcast matching (e.g., "engineer" from "engineer-1")
const baseRole = agentId.replace(/-\d+$/, '')

// Build the list of to_agent values this agent should receive
const targets = [agentId, 'team']
if (baseRole !== agentId) {
  targets.push(baseRole)
}

const dbPath = join(orchestratorDir, 'data', 'messages.db')

let db
try {
  db = new DatabaseSync(dbPath)
} catch {
  process.exit(0) // DB not found — silently skip
}

try {
  // BEGIN IMMEDIATE for concurrency safety
  db.exec('BEGIN IMMEDIATE')

  const placeholders = targets.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT id, from_agent, message_type, content
    FROM messages
    WHERE session_id = ?
      AND to_agent IN (${placeholders})
      AND read = 0
    ORDER BY id ASC
  `).all(sessionId, ...targets)

  if (rows.length > 0) {
    // Mark as read
    const ids = rows.map(r => r.id)
    const idPlaceholders = ids.map(() => '?').join(',')
    db.prepare(`UPDATE messages SET read = 1 WHERE id IN (${idPlaceholders})`).run(...ids)

    db.exec('COMMIT')

    // Format messages
    const formatted = rows.map(r => {
      let content = r.content
      // Clean up for single-line display
      content = String(content).replace(/\n/g, ' ').replace(/\r/g, '')
      return `[MESSAGE from ${r.from_agent}] [${r.message_type}]: ${content}`
    })
    const contextText = `NEW TEAM MESSAGE(S): ${formatted.join(' | ')}`

    if (hookEvent === 'Stop') {
      // Stop hook: put messages IN reason (Claude Code only shows reason to model, not additionalContext)
      const output = {
        decision: 'block',
        reason: `New team messages received. Process these before stopping.\n\n${contextText}`
      }
      process.stdout.write(JSON.stringify(output))
    } else {
      // PostToolUse / UserPromptSubmit / SessionStart: inject as additionalContext
      const output = {
        hookSpecificOutput: {
          hookEventName: hookEvent,
          additionalContext: contextText
        }
      }
      process.stdout.write(JSON.stringify(output))
    }
  } else {
    db.exec('COMMIT')

    if (hookEvent === 'Stop') {
      // No messages — allow stop.
      // The parent's foreground Task sub-agent handles message waiting.
      process.exit(0)
    }
    // PostToolUse / UserPromptSubmit / SessionStart with no messages: exit 0, no output
  }
} catch (err) {
  try { db.exec('ROLLBACK') } catch { /* ignore */ }
  // Don't crash hooks on errors — silently skip
  process.exit(0)
} finally {
  try { db.close() } catch { /* ignore */ }
}
