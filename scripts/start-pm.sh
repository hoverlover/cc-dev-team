#!/bin/bash
set -e

ORCHESTRATOR_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$(pwd)"
PM_DIR="$ORCHESTRATOR_DIR/agents/pm"
INSTANCE_DIR="$PM_DIR/.claude"

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                   CC DEV TEAM - PM AGENT                   ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  Project: $PROJECT_DIR"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Store project directory for PM to reference
mkdir -p "$INSTANCE_DIR"
echo "$PROJECT_DIR" > "$INSTANCE_DIR/project-dir"

# Write instance info for hooks
echo "$INSTANCE_DIR" > "$PM_DIR/.claude/current-instance"
echo "pm" > "$PM_DIR/.claude/current-agent-id"

# Check if broker is running
if ! nc -z localhost 3100 2>/dev/null; then
  echo "Warning: Broker not detected. Start it first with:"
  echo "   $ORCHESTRATOR_DIR/scripts/start-broker.sh"
  echo ""
  read -p "Start broker in background? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    cd "$ORCHESTRATOR_DIR"
    if [ ! -d "node_modules" ]; then
      echo "Installing dependencies..."
      npm install
    fi
    node broker/server.js &
    BROKER_PID=$!
    echo "Broker started (PID: $BROKER_PID)"
    sleep 2
  else
    exit 1
  fi
fi

# Export environment variables for hooks
export AGENT_ID="pm"
export INSTANCE_DIR="$INSTANCE_DIR"
export PROJECT_DIR="$PROJECT_DIR"
export ORCHESTRATOR_DIR="$ORCHESTRATOR_DIR"

# Cleanup function
cleanup() {
  echo ""
  echo "Shutting down PM..."
}
trap cleanup EXIT

# Start Claude Code via PTY wrapper (handles broker connection and message injection)
cd "$PM_DIR"
echo "Starting Claude Code with message injection..."
echo ""

node "$ORCHESTRATOR_DIR/tools/claude-wrapper.js" \
  --agent-id "pm" \
  --agent-dir "$PM_DIR" \
  --instance-dir "$INSTANCE_DIR"
