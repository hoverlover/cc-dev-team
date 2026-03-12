#!/usr/bin/env bash
# Build and push the Docker image to Fly.io registry.
#
# Usage: ./scripts/fly-deploy-image.sh
#
# This pushes the image only — Machines are created on-demand
# by the Vercel API, not by fly deploy.

set -euo pipefail

APP_NAME="${FLY_APP_NAME:-cc-dev-team}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "Building and pushing image for app: $APP_NAME"
echo "Project root: $PROJECT_ROOT"

cd "$PROJECT_ROOT"

# Push image to Fly registry (builds remotely, does not create a Machine)
fly deploy --build-only --push

echo ""
echo "Image pushed to registry.fly.io/$APP_NAME"
echo "Machines will be created on-demand by the Vercel API."
