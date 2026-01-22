#!/bin/bash
set -e

ORCHESTRATOR_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_TYPE="$1"

if [ -z "$AGENT_TYPE" ]; then
  echo "Usage: start-agent.sh <role>"
  echo ""
  echo "Available roles:"
  echo "  architect     - Principal Architect (system design, architecture)"
  echo "  engineer      - Senior Engineer (auto-assigns ID: engineer-1, engineer-2, etc.)"
  echo "  qa            - QA Tester (testing, verification)"
  echo "  code-auditor  - Code Auditor (security, architecture, quality review)"
  exit 1
fi

# Determine if this role supports multiple instances
MULTI_INSTANCE_ROLES="engineer"

if echo "$MULTI_INSTANCE_ROLES" | grep -qw "$AGENT_TYPE"; then
  # Get next available instance ID from broker
  echo "Checking for available instance ID..."
  INSTANCE_ID=$(node "$ORCHESTRATOR_DIR/tools/next-agent-id.js" "$AGENT_TYPE" 2>/dev/null || echo "1")
  AGENT_ID="${AGENT_TYPE}-${INSTANCE_ID}"
  AGENT_DIR="$ORCHESTRATOR_DIR/agents/$AGENT_TYPE"
else
  AGENT_ID="$AGENT_TYPE"
  AGENT_DIR="$ORCHESTRATOR_DIR/agents/$AGENT_TYPE"
fi

if [ ! -d "$AGENT_DIR" ]; then
  echo "Error: Agent directory not found: $AGENT_DIR"
  exit 1
fi

AGENT_ID_UPPER=$(echo "$AGENT_ID" | tr '[:lower:]' '[:upper:]')
echo "╔════════════════════════════════════════════════════════════╗"
echo "║         AGENTIC ORCHESTRATOR - $AGENT_ID_UPPER AGENT"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  Waiting for project assignment from PM...                 ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check if broker is running
if ! nc -z localhost 3100 2>/dev/null; then
  echo "Warning: Broker not detected at localhost:3100"
  echo "   Start it first with: $ORCHESTRATOR_DIR/scripts/start-broker.sh"
  exit 1
fi

# Create instance-specific .claude directory for pending messages
INSTANCE_DIR="$AGENT_DIR/.claude/instances/$AGENT_ID"
mkdir -p "$INSTANCE_DIR"

# Write instance info to a file the hooks can read
echo "$INSTANCE_DIR" > "$AGENT_DIR/.claude/current-instance"
echo "$AGENT_ID" > "$AGENT_DIR/.claude/current-agent-id"

# Export environment variables for hooks
export AGENT_ID="$AGENT_ID"
export AGENT_TYPE="$AGENT_TYPE"
export INSTANCE_DIR="$INSTANCE_DIR"
export ORCHESTRATOR_DIR="$ORCHESTRATOR_DIR"

# Cleanup function
cleanup() {
  echo ""
  echo "Shutting down $AGENT_ID..."
  # Clean up instance directory if empty
  rmdir "$INSTANCE_DIR" 2>/dev/null || true
}
trap cleanup EXIT

# Start Claude Code via PTY wrapper (handles broker connection and message injection)
cd "$AGENT_DIR"
echo "Starting Claude Code with message injection..."
echo ""

node "$ORCHESTRATOR_DIR/tools/claude-wrapper.js" \
  --agent-id "$AGENT_ID" \
  --agent-dir "$AGENT_DIR" \
  --instance-dir "$INSTANCE_DIR"
