#!/bin/bash
# Start the dashboard server

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORCHESTRATOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ORCHESTRATOR_DIR/dashboard"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dashboard dependencies..."
  bun install
fi

bun run dev
