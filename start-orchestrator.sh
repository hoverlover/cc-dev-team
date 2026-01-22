#!/bin/bash
#
# Start the Agentic Orchestrator
#
# Starts the message broker, dashboard, and all agents in headless mode.
# All agent terminals are accessible via the dashboard at http://localhost:3000
#
# Usage: ./start-orchestrator.sh [options]
#
# Options:
#   --no-broker      Skip starting the broker (if already running)
#   --no-dashboard   Skip starting the dashboard (if already running)
#   --agents         Comma-separated list of agents to start (default: all)
#   --help           Show this help message
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default settings
START_BROKER=true
START_DASHBOARD=true
AGENTS="pm,architect,engineer,qa-engineer,code-auditor,ui-ux"

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
    --agents)
      AGENTS="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [options]"
      echo ""
      echo "Options:"
      echo "  --no-broker      Skip starting the broker (if already running)"
      echo "  --no-dashboard   Skip starting the dashboard (if already running)"
      echo "  --agents         Comma-separated list of agents to start (default: all)"
      echo "  --help           Show this help message"
      echo ""
      echo "Available agents: pm, architect, engineer, qa-engineer, code-auditor, ui-ux"
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
  wait
  echo -e "${GREEN}All processes stopped.${NC}"
}

trap cleanup SIGINT SIGTERM

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║           AGENTIC ORCHESTRATOR - STARTUP                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Start broker
if [ "$START_BROKER" = true ]; then
  echo -e "${YELLOW}Starting message broker...${NC}"
  cd "$SCRIPT_DIR/broker"
  node server.js &
  PIDS+=($!)
  sleep 2
  echo -e "${GREEN}Broker started on port 3100${NC}"
else
  echo -e "${YELLOW}Skipping broker (--no-broker)${NC}"
fi

# Start dashboard
if [ "$START_DASHBOARD" = true ]; then
  echo -e "${YELLOW}Starting dashboard...${NC}"
  cd "$SCRIPT_DIR/dashboard"
  npm run dev > /dev/null 2>&1 &
  PIDS+=($!)
  sleep 3
  echo -e "${GREEN}Dashboard started on port 3000${NC}"
else
  echo -e "${YELLOW}Skipping dashboard (--no-dashboard)${NC}"
fi

# Parse agents list
IFS=',' read -ra AGENT_ARRAY <<< "$AGENTS"
STARTED_AGENTS=0

# Start each agent in headless mode
for agent in "${AGENT_ARRAY[@]}"; do
  agent=$(echo "$agent" | xargs)  # Trim whitespace

  AGENT_DIR="$SCRIPT_DIR/agents/$agent"

  if [ ! -d "$AGENT_DIR" ]; then
    echo -e "${RED}Agent directory not found: $AGENT_DIR${NC}"
    continue
  fi

  echo -e "${YELLOW}Starting $agent in headless mode...${NC}"

  node "$SCRIPT_DIR/tools/claude-wrapper.js" \
    --agent-id "$agent" \
    --agent-dir "$AGENT_DIR" \
    --headless &

  PIDS+=($!)
  STARTED_AGENTS=$((STARTED_AGENTS + 1))
  sleep 1
done

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    ALL SYSTEMS RUNNING                     ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Broker:    http://localhost:3100                          ║${NC}"
echo -e "${GREEN}║  Dashboard: http://localhost:3000                          ║${NC}"
echo -e "${GREEN}║  Agents:    ${STARTED_AGENTS} running in headless mode                    ║${NC}"
echo -e "${GREEN}╠════════════════════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║  Press Ctrl+C to stop all processes                        ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Wait for all processes
wait
