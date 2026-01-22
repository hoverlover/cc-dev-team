#!/usr/bin/env python3
"""
Hook script that runs on session start.
Provides initial context about the project and any pending messages.
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
        project_file = os.path.join(instance_dir, 'project-dir')
        pending_file = os.path.join(instance_dir, 'pending-messages')
    else:
        project_file = os.path.join(claude_dir, 'project-dir')
        pending_file = os.path.join(claude_dir, 'pending-messages')

    context_parts = []

    # Try to get agent ID from env var, then from file
    agent_id = os.environ.get('AGENT_ID')
    if not agent_id:
        agent_id_file = os.path.join(claude_dir, 'current-agent-id')
        if os.path.exists(agent_id_file):
            try:
                with open(agent_id_file, 'r') as f:
                    agent_id = f.read().strip()
            except IOError:
                agent_id = 'agent'
        else:
            agent_id = 'agent'

    context_parts.append(f"AGENT ID: {agent_id}")

    # Check for project directory
    if os.path.exists(project_file):
        try:
            with open(project_file, 'r') as f:
                project_dir = f.read().strip()
                if project_dir:
                    context_parts.append(f"PROJECT DIRECTORY: {project_dir}")

                    # Check if project has its own CLAUDE.md
                    project_claude = os.path.join(project_dir, 'CLAUDE.md')
                    if os.path.exists(project_claude):
                        context_parts.append(f"Note: Project has its own CLAUDE.md at {project_claude}")
        except IOError:
            pass

    # Check for pending messages
    if os.path.exists(pending_file):
        try:
            with open(pending_file, 'r') as f:
                content = f.read().strip()
                if content:
                    messages = json.loads(content)
                    if messages and len(messages) > 0:
                        context_parts.append(f"PENDING: You have {len(messages)} pending message(s). Read them at {pending_file}")
        except (json.JSONDecodeError, IOError):
            pass

    if context_parts:
        result = {
            "hookSpecificOutput": {
                "hookEventName": "SessionStart",
                "additionalContext": '\n'.join(context_parts)
            }
        }
        print(json.dumps(result))

    sys.exit(0)

if __name__ == '__main__':
    main()
