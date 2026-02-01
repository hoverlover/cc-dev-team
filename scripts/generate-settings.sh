#!/bin/bash
#
# Generate settings.json files from templates
#
# Replaces placeholders with actual paths:
#   __ORCHESTRATOR_DIR__ -> directory where this script lives (parent of scripts/)
#   __HOME_DIR__ -> user's home directory
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORCHESTRATOR_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Find all template files and generate settings.json from them
for template in "$ORCHESTRATOR_DIR"/agents/*/.claude/settings.template.json; do
  if [ -f "$template" ]; then
    settings_file="${template%.template.json}.json"

    # Replace placeholders
    sed -e "s|__ORCHESTRATOR_DIR__|$ORCHESTRATOR_DIR|g" \
        -e "s|__HOME_DIR__|$HOME|g" \
        "$template" > "$settings_file"

    echo "Generated: $settings_file"
  fi
done

echo "Settings generation complete."
