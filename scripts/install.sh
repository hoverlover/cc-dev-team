#!/bin/bash
# Agentic Orchestrator Installation Script
# Generates settings.json files with correct paths for this installation

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORCHESTRATOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Installing Agentic Orchestrator..."
echo "Directory: $ORCHESTRATOR_DIR"
echo ""

# Install npm dependencies
echo "Installing npm dependencies..."
cd "$ORCHESTRATOR_DIR"
npm install

# Generate settings.json for each agent
AGENTS="pm architect engineer qa code-auditor"

for agent in $AGENTS; do
  AGENT_DIR="$ORCHESTRATOR_DIR/agents/$agent"
  CLAUDE_DIR="$AGENT_DIR/.claude"
  SETTINGS_FILE="$CLAUDE_DIR/settings.json"

  mkdir -p "$CLAUDE_DIR"

  echo "Generating $SETTINGS_FILE..."

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
  }
}
EOF
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
echo "Installation complete!"
echo ""
echo "To start the system:"
echo "  1. Start the broker:  $ORCHESTRATOR_DIR/scripts/start-broker.sh"
echo "  2. Start PM agent:    cd <your-project> && $ORCHESTRATOR_DIR/scripts/start-pm.sh"
echo "  3. Start other agents: $ORCHESTRATOR_DIR/scripts/start-agent.sh <role>"
echo ""
