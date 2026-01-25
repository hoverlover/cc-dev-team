#!/bin/bash
# Publish installer to npm
# Usage: ./scripts/npm-publish.sh [patch|minor|major]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
INSTALLER_DIR="$ROOT_DIR/installer"

BUMP_TYPE="${1:-patch}"

cd "$INSTALLER_DIR"

# Get current version
OLD_VERSION=$(node -p "require('./package.json').version")

# Bump version
npm version "$BUMP_TYPE" --no-git-tag-version
NEW_VERSION=$(node -p "require('./package.json').version")

echo "Bumping $OLD_VERSION → $NEW_VERSION"

# Also bump root package.json to keep versions in sync
cd "$ROOT_DIR"
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version

# Commit and tag from root
git add installer/package.json package.json
git commit -m "Bump installer to v$NEW_VERSION"
git tag "v$NEW_VERSION"
git push origin main
git push origin "v$NEW_VERSION"

# Publish to npm
cd "$INSTALLER_DIR"
echo ""
echo "Publishing to npm..."
npm publish --access public

echo ""
echo "✓ Published @hoverlover/cc-dev-team v$NEW_VERSION"
