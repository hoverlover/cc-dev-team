/**
 * cc-dev-team messaging extension for Pi.
 *
 * Replaces three Claude Code scripts:
 *   - hooks/check-messages.js (message delivery between tool calls)
 *   - tools/wait-for-messages.js (idle polling)
 *   - hooks/block-background-bash.sh (dangerous command blocking)
 *
 * Uses SQLite (via node:sqlite) for message storage, matching the
 * existing broker's schema.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { DatabaseSync } from "node:sqlite";

export default function (pi: ExtensionAPI) {
  const role = process.env.CC_AGENT_ROLE!;
  const sessionId = process.env.CC_SESSION_ID!;
  const dbPath = process.env.CC_DB_PATH!;

  let db: DatabaseSync;
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // --- Database setup ---
  function openDb() {
    db = new DatabaseSync(dbPath);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA busy_timeout = 5000");
  }

  function getUnreadMessages(): Array<{
    id: number;
    from_agent: string;
    message_type: string;
    content: string;
  }> {
    // Match messages sent to this agent specifically, or to the base role,
    // or broadcast to 'team'
    const baseRole = role.replace(/-\d+$/, "");
    const stmt = db.prepare(`
      SELECT id, from_agent, message_type, content
      FROM messages
      WHERE session_id = ? AND read = 0
        AND (to_agent = ? OR to_agent = 'team' OR to_agent = ?)
      ORDER BY created_at ASC
    `);
    return stmt.all(sessionId, role, baseRole) as any[];
  }

  function markRead(ids: number[]) {
    const stmt = db.prepare("UPDATE messages SET read = 1 WHERE id = ?");
    for (const id of ids) {
      stmt.run(id);
    }
  }

  function formatMessages(
    msgs: Array<{
      from_agent: string;
      message_type: string;
      content: string;
    }>,
  ): string {
    return (
      "NEW TEAM MESSAGE(S): " +
      msgs
        .map(
          (m) =>
            `[MESSAGE from ${m.from_agent}] [${m.message_type}]: ${m.content}`,
        )
        .join("\n\n")
    );
  }

  // --- Event Handlers ---

  // 1. On session start: open DB
  pi.on("session_start", async (_event, _ctx) => {
    openDb();
  });

  // 2. Before each agent run: inject pending messages into context
  pi.on("before_agent_start", async (_event, _ctx) => {
    const msgs = getUnreadMessages();
    if (msgs.length > 0) {
      markRead(msgs.map((m) => m.id));
      return {
        message: {
          customType: "team-messages",
          content: formatMessages(msgs),
          display: true,
        },
      };
    }
  });

  // 3. After each tool execution: check for new messages, steer if found
  pi.on("tool_execution_end", async (_event, _ctx) => {
    const msgs = getUnreadMessages();
    if (msgs.length > 0) {
      markRead(msgs.map((m) => m.id));
      pi.sendMessage(
        {
          customType: "team-messages",
          content: formatMessages(msgs),
          display: true,
        },
        { triggerTurn: true, deliverAs: "steer" },
      );
    }
  });

  // 4. On agent end: start polling for idle wake-up
  pi.on("agent_end", async (_event, _ctx) => {
    startPolling();
  });

  // 5. On agent start: stop polling (agent is now active)
  pi.on("agent_start", async (_event, _ctx) => {
    stopPolling();
  });

  // 6. Block dangerous bash commands
  pi.on("tool_call", async (event, _ctx) => {
    if (event.toolName === "bash") {
      const cmd = (event.input as any)?.command || "";
      if (/rm\s+-rf\s+\/(?!tmp)/.test(cmd) || /:\(\)\{/.test(cmd)) {
        return { block: true, reason: "Dangerous command blocked by policy" };
      }
    }
  });

  // 7. Graceful shutdown
  pi.on("session_shutdown", async (_event, _ctx) => {
    stopPolling();
    if (db) db.close();
  });

  // --- Idle Polling ---
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      try {
        const msgs = getUnreadMessages();
        if (msgs.length > 0) {
          markRead(msgs.map((m) => m.id));
          stopPolling();
          pi.sendUserMessage(formatMessages(msgs));
        }
      } catch {
        // DB may be closed during shutdown
      }
    }, 2000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // --- Custom Tool: send_msg ---
  pi.registerTool({
    name: "send_msg",
    label: "Send Message",
    description:
      "Send a message to another agent on your team. Messages are delivered asynchronously.",
    promptSnippet: `Use send_msg to communicate with your team members.
Recipients: pm, architect, engineer, qa-engineer, ui-ux, code-auditor, docs-auditor, team (broadcast).
Message types: TASK_ASSIGNMENT, STATUS_UPDATE, QUESTION, RESPONSE, HANDOFF, APPROVE, BLOCK, PROPOSAL, DECISION, FEEDBACK, BLOCKED, GO_AHEAD, PLAN_READY.`,
    parameters: Type.Object({
      to: Type.String({
        description:
          "Recipient agent ID (e.g., 'pm', 'engineer-1', 'team')",
      }),
      type: Type.String({
        description:
          "Message type (e.g., 'STATUS_UPDATE', 'QUESTION', 'RESPONSE')",
      }),
      content: Type.String({ description: "Message content (plain text)" }),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      try {
        db.prepare(
          `INSERT INTO messages (session_id, from_agent, to_agent, message_type, content, read)
           VALUES (?, ?, ?, ?, ?, 0)`,
        ).run(sessionId, role, params.to, params.type, params.content);

        return {
          content: [
            {
              type: "text",
              text: `Message sent: ${role} → ${params.to} [${params.type}]`,
            },
          ],
          details: { to: params.to, type: params.type },
        };
      } catch (err: any) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to send message: ${err.message}`,
            },
          ],
          details: {},
          isError: true,
        };
      }
    },
  });
}
