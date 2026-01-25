#!/bin/bash
# CC Agent Orchestration Installation Script
# Generates settings.json files with correct paths for this installation

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORCHESTRATOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Installing CC Agent Orchestration..."
echo "Directory: $ORCHESTRATOR_DIR"
echo ""

# Install npm dependencies
echo "Installing npm dependencies..."
cd "$ORCHESTRATOR_DIR"
npm install

# Generate settings.json for each agent
AGENTS="pm architect engineer qa-engineer ui-ux code-auditor"

for agent in $AGENTS; do
  AGENT_DIR="$ORCHESTRATOR_DIR/agents/$agent"
  CLAUDE_DIR="$AGENT_DIR/.claude"
  SETTINGS_FILE="$CLAUDE_DIR/settings.json"

  mkdir -p "$CLAUDE_DIR"

  echo "Generating $SETTINGS_FILE..."

  if [ "$agent" = "pm" ]; then
    # PM agent gets additional permissions and allowExternalMdIncludes
    cat > "$SETTINGS_FILE" << EOF
{
  "allowExternalMdIncludes": [
    "$ORCHESTRATOR_DIR/docs/*"
  ],
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$ORCHESTRATOR_DIR/hooks/session-start.py"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read|Edit|Write|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$ORCHESTRATOR_DIR/hooks/check-pending.py"
          }
        ]
      }
    ]
  },
  "permissions": {
    "allow": [
      "Bash(send-msg:*)",
      "Bash(rename-sessions:*)",
      "Bash(get-roster)",
      "Bash(git:*)",
      "Bash(cd:*)",
      "Bash(gh:*)",
      "Skill(new-feature)"
    ]
  }
}
EOF
  else
    # Other agents get base configuration with orchestrator tool permissions
    cat > "$SETTINGS_FILE" << EOF
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "$ORCHESTRATOR_DIR/hooks/session-start.py"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Read|Edit|Write|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "$ORCHESTRATOR_DIR/hooks/check-pending.py"
          }
        ]
      }
    ]
  },
  "permissions": {
    "allow": [
      "Bash(send-msg:*)",
      "Bash(sync-workspace:*)",
      "Bash(get-roster)",
      "Bash(git:*)",
      "Bash(cd:*)",
      "Bash(gh:*)"
    ]
  }
}
EOF
  fi
done

# Generate project-level settings with permissions
PROJECT_SETTINGS="$ORCHESTRATOR_DIR/.claude/settings.json"
mkdir -p "$ORCHESTRATOR_DIR/.claude"

echo "Generating $PROJECT_SETTINGS..."
cat > "$PROJECT_SETTINGS" << EOF
{
  "permissions": {
    "allow": [
      "Bash(rm *pending-messages*)",
      "Bash(rm */.claude/*)",
      "Bash(node *)",
      "Bash(npm *)"
    ]
  }
}
EOF

# Make hook scripts executable
chmod +x "$ORCHESTRATOR_DIR/hooks/"*.py
chmod +x "$ORCHESTRATOR_DIR/scripts/"*.sh
chmod +x "$ORCHESTRATOR_DIR/tools/claude-wrapper.js"

echo ""
echo "Configuration complete!"
