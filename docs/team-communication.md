# Team Communication

You communicate with your team through a message broker via socket.io. Messages are delivered automatically between tool calls via Claude Code hooks.

## IMPORTANT: Always Respond via Broker

**Your terminal output is NOT visible to other agents.** When you receive a message and need to respond, you MUST use the `send-msg` command. Simply typing your response won't deliver it - only the broker can relay messages between agents.

## Receiving Messages

Messages from other agents are automatically delivered between tool calls
via Claude Code hooks. They appear as context injected by the system —
you don't need to check for them manually.

When you see "NEW TEAM MESSAGE(S): [MESSAGE from <agent>] [<type>]: <content>",
process the message and respond via send-msg.

## Waiting for Messages (Background Poller)

When the system instructs you to start the background message poller,
run this exact command using Bash with run_in_background=true:

```
ensure-poller
```

No arguments required. It reads AGENT_ID and SESSION_ID from environment
variables. It is idempotent — if a poller is already running, it silently
succeeds.

### Your Two Rules

1. When the system says "Run: ensure-poller using Bash with
   run_in_background=true" — do it. Every time. Do not check if one is
   running. Do not skip it. Do not add arguments. Just run the command
   exactly as instructed.
2. When messages are delivered (you see "NEW TEAM MESSAGE(S): ...") —
   process them and respond via send-msg.

That is it. The system handles everything else:
- The Stop hook will block you from going idle until a poller is running
- The poller will wake you when messages arrive
- Messages are delivered automatically via hooks
- After you finish processing a message, the Stop hook restarts the cycle

You do NOT need to: check if a poller is running, interpret exit codes,
decide when to restart the poller, or handle poller errors.

## Sending Messages

```bash
send-msg <your-agent-id> <to> <type> "<content>"
```

Replace `<your-agent-id>` with your agent ID (e.g., `pm`, `architect`, `engineer`, `qa-engineer`, `ui-ux`, `code-auditor`).

## Message Format

**Use plain text for message content.** The message type (QUESTION, RESPONSE, etc.) signals intent - the content should be natural language.

Examples:
```bash
# Asking a question
send-msg pm architect QUESTION "We need swipe-to-dismiss for mobile notifications. The X button uses hover which doesn't work on mobile. What's the best approach? Any React libraries you'd recommend?"

# Responding
send-msg architect pm RESPONSE "I recommend react-swipeable for gesture handling. Use Framer Motion for the dismiss animation. Key files: NotificationItem.tsx, useSwipeGesture.ts. Watch out for interrupted gestures."

# Assigning a task
send-msg pm engineer TASK_ASSIGNMENT "Implement swipe-to-dismiss for notifications per story #42. Plan is at .claude/plans/42-swipe-dismiss.md. Focus on mobile touch handling."

# Reporting status
send-msg engineer pm STATUS_UPDATE "Swipe gesture detection working. Now implementing the animation. About 60% complete."

# Handing off work
send-msg engineer qa-engineer HANDOFF "Swipe-to-dismiss is ready for testing. Test on mobile viewports. Edge cases: rapid swipes, interrupted gestures, swipe threshold."
```

**Do NOT use JSON** for message content unless absolutely necessary.

## Message Recipients

- `pm` - Project Manager (human interface, coordination)
- `architect` - Principal Architect (system design)
- `engineer` - Senior Engineer (implementation)
- `qa-engineer` - QA Engineer (test verification)
- `ui-ux` - UI/UX Design Expert (design review, accessibility)
- `code-auditor` - Code Auditor (code quality gate)
- `docs-auditor` - Documentation Auditor (documentation quality gate)
- `team` - Broadcast to all agents

### Numbered Agent IDs

When multiple instances of the same role exist (e.g., multiple engineers), they're assigned numbered IDs:
- First engineer: `engineer` (or `engineer-1` after second spawns)
- Second engineer: `engineer-2`
- Third engineer: `engineer-3`
- etc.

**Addressing rules:**
- Send to `engineer` → broadcasts to ALL engineer instances
- Send to `engineer-1` → goes ONLY to that specific engineer
- Send to `engineer-2` → goes ONLY to that specific engineer

**When multiple engineers exist, always use specific IDs** (engineer-1, engineer-2) to avoid unintended broadcasts. Use `get-roster` to see connected agents and their IDs.

## Common Message Types

| Type | Purpose |
|------|---------|
| `PROJECT_INIT` | **System-level only.** Automatically sent by the broker to set the project directory. Requires JSON format (`{"project_dir": "..."}`) — agents should NOT send this manually. |
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

When an engineer creates a worktree or changes the working directory, use the `sync-workspace` tool to automatically sync all agents:

```bash
# After creating/switching to a worktree
sync-workspace engineer switch /path/to/worktree

# After removing a worktree (switch back to original)
sync-workspace engineer remove /path/to/original/project
```

This automatically runs `cd` on all agents in the session - no manual action needed by receiving agents.

**Note:** Only engineers typically need to use this (when creating worktrees). Other agents will be synced automatically.
