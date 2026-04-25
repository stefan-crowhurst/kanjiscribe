#!/bin/bash
set -e

# Deploy Kanjiscribe from dev build to production directory
# Usage: ./scripts/deploy.sh /media/default/ssd/prod/kanjiscribe

TARGET="${1:-/media/default/ssd/prod/kanjiscribe}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "Deploying Kanjiscribe to $TARGET..."

# Build everything first
echo "Building..."
cd "$REPO_ROOT"
./scripts/build-prod.sh

# Create target directory structure
mkdir -p "$TARGET/apps/api/dist"
mkdir -p "$TARGET/apps/api/node_modules"
mkdir -p "$TARGET/apps/web/dist"
mkdir -p "$TARGET/systemd"
mkdir -p "$TARGET/data"
mkdir -p "$TARGET/docs"

# Copy bundled API server + migrations
echo "Copying API bundle..."
cp -r "$REPO_ROOT/apps/api/dist/"* "$TARGET/apps/api/dist/"

# Copy built frontend
echo "Copying web frontend..."
cp -r "$REPO_ROOT/apps/web/dist/"* "$TARGET/apps/web/dist/"

# Create a minimal package.json and install only better-sqlite3 in the target.
# esbuild bundles all JS code; only the native addon needs node_modules at runtime.
# We use npm (not pnpm) here to get a traditional flat node_modules structure
# that works without the pnpm workspace virtual store.
echo "Installing better-sqlite3 in target..."
cat > "$TARGET/apps/api/package.json" << 'EOF'
{
  "name": "@kanjiscribe/api-prod",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "better-sqlite3": "^11.8.1"
  }
}
EOF

cd "$TARGET/apps/api"
npm install --omit=dev --no-package-lock 2>&1 | tail -5

cd "$REPO_ROOT"

# Copy systemd service
echo "Copying systemd service..."
cp "$REPO_ROOT/systemd/kanjiscribe.service" "$TARGET/systemd/"

# Copy docs
echo "Copying docs..."
cp -r "$REPO_ROOT/docs/"* "$TARGET/docs/" 2>/dev/null || true

# Set ownership to current user if running as root
if [ "$(id -u)" -eq 0 ]; then
    chown -R "$(logname 2>/dev/null || echo "$SUDO_USER"):$(logname 2>/dev/null || echo "$SUDO_USER")" "$TARGET" 2>/dev/null || true
fi

echo ""
echo "Deployment complete to $TARGET"
echo ""
echo "Next steps:"
echo "1. Copy your database + kanji-svg data:"
echo "   cp -r $REPO_ROOT/data/* $TARGET/data/"
echo "2. Install the systemd service:"
echo "   sudo cp $TARGET/systemd/kanjiscribe.service /etc/systemd/system/"
echo "   sudo systemctl daemon-reload"
echo "   sudo systemctl enable kanjiscribe"
echo "   sudo systemctl start kanjiscribe"
echo ""
echo "The deployed app contains:"
echo "  - apps/api/dist/server.js  (bundled, ~1.8MB)"
echo "  - apps/api/dist/db/sql/    (migrations)"
echo "  - apps/web/dist/           (frontend)"
echo "  - apps/api/node_modules/better-sqlite3/ (native addon)"
echo ""
echo "No other node_modules are needed in production."
