#!/usr/bin/env python3
"""
Hook script that checks for pending messages and notifies the agent.
This hook runs before tool use and adds context if there are unread messages.
"""

import json
import os
import sys

def main():
    agent_dir = os.getcwd()
    claude_dir = os.path.join(agent_dir, '.claude')

    # Try to get instance directory from env var, then from file, then fallback
    instance_dir = os.environ.get('INSTANCE_DIR')
    if not instance_dir:
        instance_file = os.path.join(claude_dir, 'current-instance')
        if os.path.exists(instance_file):
            try:
                with open(instance_file, 'r') as f:
                    instance_dir = f.read().strip()
            except IOError:
                pass

    # If we have an instance dir, use it; otherwise use default .claude
    if instance_dir and os.path.exists(instance_dir):
        pending_file = os.path.join(instance_dir, 'pending-messages')
    else:
        pending_file = os.path.join(claude_dir, 'pending-messages')

    # Check if there are pending messages
    if os.path.exists(pending_file):
        try:
            with open(pending_file, 'r') as f:
                content = f.read().strip()
                if content:
                    messages = json.loads(content)
                    if messages and len(messages) > 0:
                        # Count messages by type
                        types = {}
                        for msg in messages:
                            t = msg.get('message_type', 'UNKNOWN')
                            types[t] = types.get(t, 0) + 1

                        summary = ', '.join([f"{count} {t}" for t, count in types.items()])

                        result = {
                            "hookSpecificOutput": {
                                "hookEventName": "PreToolUse",
                                "additionalContext": f"PENDING MESSAGES: You have {len(messages)} unread message(s) ({summary}). Read the file at {pending_file} to see them, then delete the file after processing."
                            }
                        }
                        print(json.dumps(result))
                        sys.exit(0)
        except (json.JSONDecodeError, IOError):
            pass

    # No output if no pending messages
    sys.exit(0)

if __name__ == '__main__':
    main()
