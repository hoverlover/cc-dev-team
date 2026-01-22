# Team Communication

You communicate with your team through a message broker via socket.io. Messages are delivered in real-time and injected directly into your conversation.

## IMPORTANT: Always Respond via Broker

**Your terminal output is NOT visible to other agents.** When you receive a message and need to respond, you MUST use the send-message.js tool. Simply typing your response won't deliver it - only the broker can relay messages between agents.

## Receiving Messages

Messages from other agents appear as `[MESSAGE from <agent>] [<type>]: <content>`. When you receive a message:
1. Read and understand the content
2. **Send your response using the send-message.js tool** (not just terminal output)
3. No file cleanup needed - messages are delivered in real-time

## Sending Messages

```bash
node /Users/cboyd/code/agentic-orchestrator/tools/send-message.js <your-agent-id> <to> <type> '<content>'
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
