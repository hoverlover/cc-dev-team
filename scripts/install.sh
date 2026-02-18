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

REQUIRED_SKILLS="new-feature smart-commit worktree dev-server wireframe"
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

# Generate settings.json files from templates
echo ""
echo "Generating agent settings..."
"$SCRIPT_DIR/generate-settings.sh"

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
