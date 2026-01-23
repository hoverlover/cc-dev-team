# Team Communication

You communicate with your team through a message broker via socket.io. Messages are delivered in real-time and injected directly into your conversation.

## IMPORTANT: Always Respond via Broker

**Your terminal output is NOT visible to other agents.** When you receive a message and need to respond, you MUST use the `send-msg` command. Simply typing your response won't deliver it - only the broker can relay messages between agents.

## Receiving Messages

Messages from other agents appear as `[MESSAGE from <agent>] [<type>]: <content>`. When you receive a message:
1. Read and understand the content
2. **Send your response using the `send-msg` command** (not just terminal output)
3. No file cleanup needed - messages are delivered in real-time

## Sending Messages

```bash
send-msg <your-agent-id> <to> <type> '<content>'
```

Replace `<your-agent-id>` with your agent ID (e.g., `pm`, `architect`, `engineer`, `qa-engineer`, `ui-ux`, `code-auditor`).

## Message Recipients

- `pm` - Project Manager (human interface, coordination)
- `architect` - Principal Architect (system design)
- `engineer` - Senior Engineer (implementation)
- `qa-engineer` - QA Engineer (test verification)
- `ui-ux` - UI/UX Design Expert (design review, accessibility)
- `code-auditor` - Code Auditor (final quality gate)
- `team` - Broadcast to all agents

## Common Message Types

| Type | Purpose |
|------|---------|
| `PROJECT_INIT` | Set project directory for all agents |
| `WORKSPACE_UPDATE` | Notify team of workspace/worktree change |
| `TASK_ASSIGNMENT` | Assign work to an agent |
| `GO_AHEAD` | Approval to proceed |
| `STATUS_UPDATE` | Report progress |
| `BLOCKED` | Need help or decision |
| `QUESTION` | Request clarification |
| `RESPONSE` | Answer a question |
| `FEEDBACK` | Provide input on proposals |
| `PROPOSAL` | Propose an approach |
| `DECISION` | Record a final decision |
| `HANDOFF` | Pass work to next stage |
| `APPROVE` | Quality gate passed |
| `BLOCK` | Quality gate failed, issues to fix |

## Workspace Synchronization

When any agent changes their working directory (especially when using `/worktree`), they MUST broadcast to the team:

```bash
send-msg <your-id> team WORKSPACE_UPDATE '{"path": "/new/working/directory", "action": "switch|remove"}'
```

**When you receive a WORKSPACE_UPDATE:**
1. If `action` is `switch`: Change to the new directory with `cd <path>`
2. If `action` is `remove`: Change back to the original project directory

This keeps all agents synchronized so they can review each other's work in the correct location.
