#!/bin/bash
# PreToolUse hook for message-poller subagent.
# Blocks Bash calls that set run_in_background=true.
# Exit code 2 = block the tool call (per Claude Code hook spec).

INPUT=$(cat)
BACKGROUND=$(echo "$INPUT" | jq -r '.tool_input.run_in_background // false')

if [ "$BACKGROUND" = "true" ]; then
  echo "run_in_background is not allowed. Run the command in the foreground." >&2
  exit 2
fi

exit 0
