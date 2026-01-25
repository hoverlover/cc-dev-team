#!/bin/bash
#
# Start CC Agent Orchestration
#
# Starts the message broker and dashboard.
# Agents are spawned automatically when you open a project in the dashboard.
#
# Usage: ./start-orchestrator.sh [options]
#
# Options:
#   --no-broker      Skip starting the broker (if already running)
#   --no-dashboard   Skip starting the dashboard (if already running)
#   --help           Show this help message
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Get version from package.json
VERSION=$(node -p "require('$SCRIPT_DIR/package.json').version" 2>/dev/null || echo "unknown")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Default settings
START_BROKER=true
START_DASHBOARD=true

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --no-broker)
      START_BROKER=false
      shift
      ;;
    --no-dashboard)
      START_DASHBOARD=false
      shift
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --no-broker      Skip starting the broker (if already running)"
      echo "  --no-dashboard   Skip starting the dashboard (if already running)"
      echo "  --help           Show this help message"
      echo ""
      echo "Agents are spawned automatically when you open a project in the dashboard."
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      exit 1
      ;;
  esac
done

# Track PIDs for cleanup
PIDS=()

cleanup() {
  echo -e "\n${YELLOW}Shutting down...${NC}"
  for pid in "${PIDS[@]}"; do
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  # Kill any child processes
  pkill -P $$ 2>/dev/null || true
  wait 2>/dev/null || true
  echo -e "${GREEN}All processes stopped.${NC}"
}

trap cleanup SIGINT SIGTERM EXIT

echo -e "${CYAN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         CC AGENT ORCHESTRATION v${VERSION}                      ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Start broker (uses node due to better-sqlite3 native dependency)
if [ "$START_BROKER" = true ]; then
  echo -e "${YELLOW}Starting message broker...${NC}"
  cd "$SCRIPT_DIR/broker"
  node server.js &
  BROKER_PID=$!
  PIDS+=($BROKER_PID)
  sleep 2

  # Verify broker started
  if ! kill -0 $BROKER_PID 2>/dev/null; then
    echo -e "${RED}Error: Broker failed to start${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ Broker running on port 3100${NC}"
else
  echo -e "${YELLOW}Skipping broker (--no-broker)${NC}"
fi

# Start dashboard
if [ "$START_DASHBOARD" = true ]; then
  echo -e "${YELLOW}Starting dashboard...${NC}"
  cd "$SCRIPT_DIR/dashboard"
  # Build if needed (production mode)
  if [ ! -d ".next" ]; then
    echo -e "${YELLOW}Building dashboard (first run)...${NC}"
    bun run build
  fi
  bun run start &
  DASHBOARD_PID=$!
  PIDS+=($DASHBOARD_PID)
  sleep 3

  # Verify dashboard started
  if ! kill -0 $DASHBOARD_PID 2>/dev/null; then
    echo -e "${RED}Error: Dashboard failed to start${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓ Dashboard running on port 3101${NC}"
else
  echo -e "${YELLOW}Skipping dashboard (--no-dashboard)${NC}"
fi

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                 ORCHESTRATOR READY                         ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Dashboard: http://localhost:3101                          ║${NC}"
echo -e "${GREEN}║  Broker:    http://localhost:3100                          ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Open the dashboard and select a project folder to         ║${NC}"
echo -e "${GREEN}║  launch your AI team. Agents will start automatically.     ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop                                      ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Wait for processes
wait
