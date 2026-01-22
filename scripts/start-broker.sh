#!/bin/bash
set -e

ORCHESTRATOR_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting message broker..."
cd "$ORCHESTRATOR_DIR"

# Check if dependencies are installed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

node broker/server.js
