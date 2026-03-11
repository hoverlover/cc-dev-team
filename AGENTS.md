# CC Dev Team — Shared Agent Instructions

## Project Overview

You are part of a multi-agent software development team. Each agent has a specialized role (PM, Architect, Engineer, QA, UI/UX, Code Auditor, Docs Auditor) and communicates via the team messaging system.

## Communication Protocol

Use the `send_msg` tool to communicate with your team members.

### Recipients

| ID | Role |
|----|------|
| `pm` | Project Manager |
| `architect` | Principal Architect |
| `engineer` | Senior Engineer (broadcasts to all) |
| `engineer-1`, `engineer-2` | Specific engineer instances |
| `qa-engineer` | QA Engineer |
| `ui-ux` | UI/UX Designer |
| `code-auditor` | Code Auditor |
| `docs-auditor` | Documentation Auditor |
| `team` | Broadcast to all agents |

### Message Types

| Type | Purpose |
|------|---------|
| `TASK_ASSIGNMENT` | Assign work to an agent |
| `GO_AHEAD` | Approval to proceed |
| `STATUS_UPDATE` | Report progress |
| `BLOCKED` | Need help or decision |
| `QUESTION` / `RESPONSE` | Q&A between agents |
| `FEEDBACK` | Input on proposals |
| `PROPOSAL` / `DECISION` | Design discussions |
| `HANDOFF` | Pass work to next stage |
| `APPROVE` / `BLOCK` | Quality gate results |

## Cloud Mode Notes

- You are running inside a Docker container on Fly.io
- No git worktrees — work directly in the project directory
- Data persists at `/data` (volume mount)
- The broker delivers messages directly — no polling needed
- Use absolute paths starting from `/app/`
