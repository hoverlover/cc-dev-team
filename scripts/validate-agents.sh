#!/bin/bash
# Validate agent configuration
# Run this before commits to catch configuration issues early
#
# Usage: ./scripts/validate-agents.sh
# Exit codes: 0 = success, 1 = validation failed

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

FAILED=0

echo "Validating agent configuration..."
echo ""

# Check that agent scripts pass --agent-system-prompt
echo "1. Checking agent scripts pass system prompts..."

if ! grep -q "\-\-agent-system-prompt" "$ROOT_DIR/scripts/start-pm.sh"; then
  echo "   ✗ start-pm.sh missing --agent-system-prompt argument"
  FAILED=1
else
  echo "   ✓ start-pm.sh passes --agent-system-prompt"
fi

if ! grep -q "\-\-agent-system-prompt" "$ROOT_DIR/scripts/start-agent.sh"; then
  echo "   ✗ start-agent.sh missing --agent-system-prompt argument"
  FAILED=1
else
  echo "   ✓ start-agent.sh passes --agent-system-prompt"
fi

echo ""

# Check all agents have system-prompt.md
echo "2. Checking all agents have system-prompt.md..."

for agent_dir in "$ROOT_DIR/agents"/*/; do
  agent_name=$(basename "$agent_dir")
  prompt_file="$agent_dir/system-prompt.md"

  if [ ! -f "$prompt_file" ]; then
    echo "   ✗ $agent_name missing system-prompt.md"
    FAILED=1
  elif [ ! -s "$prompt_file" ]; then
    echo "   ✗ $agent_name has empty system-prompt.md"
    FAILED=1
  else
    size=$(wc -c < "$prompt_file" | tr -d ' ')
    if [ "$size" -lt 100 ]; then
      echo "   ⚠ $agent_name system-prompt.md is unusually short ($size bytes)"
    else
      echo "   ✓ $agent_name has system-prompt.md ($size bytes)"
    fi
  fi
done

echo ""

# Check @persona.md includes resolve
echo "3. Checking @persona.md includes resolve..."

for agent_dir in "$ROOT_DIR/agents"/*/; do
  agent_name=$(basename "$agent_dir")
  prompt_file="$agent_dir/system-prompt.md"

  if [ -f "$prompt_file" ]; then
    if grep -q "^@persona.md" "$prompt_file"; then
      if [ ! -f "$agent_dir/persona.md" ]; then
        echo "   ✗ $agent_name references @persona.md but file doesn't exist"
        FAILED=1
      else
        echo "   ✓ $agent_name persona.md exists"
      fi
    fi
  fi
done

echo ""

if [ "$FAILED" -eq 1 ]; then
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  VALIDATION FAILED                                          ║"
  echo "║                                                              ║"
  echo "║  Fix the issues above before committing.                    ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  exit 1
else
  echo "✓ All agent validations passed"
  exit 0
fi
