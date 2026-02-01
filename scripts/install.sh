#!/bin/bash
# CC Dev Team Installation Script
# Generates settings.json files with correct paths for this installation

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORCHESTRATOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CLAUDE_COMMANDS_DIR="$HOME/.claude/commands"

echo "Installing CC Dev Team..."
echo "Directory: $ORCHESTRATOR_DIR"
echo ""

# Install npm dependencies
echo "Installing npm dependencies..."
cd "$ORCHESTRATOR_DIR"
npm install

# Build the dashboard
echo ""
echo "Building dashboard..."
cd "$ORCHESTRATOR_DIR/dashboard"
bun install
bun run build
cd "$ORCHESTRATOR_DIR"

# Install required skills (agent-invoked, stored in ~/.claude/commands/)
# Note: Project-level skills take precedence over user-level,
# so users can override these by placing custom versions in their project's .claude/commands/
echo ""
echo "Installing skills..."
mkdir -p "$CLAUDE_COMMANDS_DIR"

REQUIRED_SKILLS="new-feature smart-commit worktree dev-server"
for skill in $REQUIRED_SKILLS; do
  SOURCE_FILE="$ORCHESTRATOR_DIR/skills/$skill.md"

  if [ -f "$SOURCE_FILE" ]; then
    cp "$SOURCE_FILE" "$CLAUDE_COMMANDS_DIR/$skill.md"
    echo "  ✓ /$skill"
  else
    echo "  ! Warning: $skill.md not found in skills/"
  fi
done

# Create worktrees directory
echo ""
echo "Creating worktrees directory..."
mkdir -p "$HOME/.cc-dev-team/worktrees"
echo "  ✓ ~/.cc-dev-team/worktrees"

# Generate settings.json for each agent
AGENTS="pm architect engineer qa-engineer ui-ux code-auditor docs-auditor"

for agent in $AGENTS; do
  AGENT_DIR="$ORCHESTRATOR_DIR/agents/$agent"
  CLAUDE_DIR="$AGENT_DIR/.claude"
  SETTINGS_FILE="$CLAUDE_DIR/settings.json"

  mkdir -p "$CLAUDE_DIR"

  echo "Generating $SETTINGS_FILE..."

  # Common spinnerVerbs for all agents
  SPINNER_VERBS='  "spinnerVerbs": {
    "mode": "replace",
    "verbs": [
      "Architecting",
      "Engineering",
      "Brewing",
      "Crafting",
      "Forging",
      "Assembling",
      "Debugging",
      "Refactoring",
      "Compiling",
      "Deploying",
      "Orchestrating",
      "Synthesizing",
      "Scheming",
      "Plotting",
      "Conjuring",
      "Manifesting",
      "Contemplating",
      "Deliberating",
      "Strategizing",
      "Calculating"
    ]
  }'

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
      "Bash(set-issue-bar:*)",
      "Bash(get-roster)",
      "Bash(git:*)",
      "Bash(cd:*)",
      "Bash(gh:*)",
      "Skill(new-feature)"
    ]
  },
$SPINNER_VERBS
}
EOF
  elif [ "$agent" = "engineer" ]; then
    # Engineer gets skill permissions and Edit/Write for dev workflow
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
      "Edit($HOME/.cc-dev-team/worktrees/**)",
      "Write($HOME/.cc-dev-team/worktrees/**)",
      "Bash(send-msg:*)",
      "Bash(sync-workspace:*)",
      "Bash(get-roster)",
      "Bash(git:*)",
      "Bash(cd:*)",
      "Bash(gh:*)",
      "Bash(npm:*)",
      "Bash(npx:*)",
      "Bash(bun:*)",
      "Skill(smart-commit)",
      "Skill(worktree)",
      "Skill(dev-server)"
    ]
  },
$SPINNER_VERBS
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
  },
$SPINNER_VERBS
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
