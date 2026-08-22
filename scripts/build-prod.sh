#!/bin/bash
set -e

echo "Building Kanjiscribe for production..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "Installing dependencies..."
pnpm install

echo "Building shared package..."
pnpm --filter @kanjiscribe/shared build

echo "Building webapp (production mode - API base http://raspberrypi:${KANJISCRIBE_API_PORT:-52654})..."
# The frontend is served by the api over Tailscale, so API calls are not
# same-origin-relative: bake an absolute base pointing at the Pi's Tailscale
# host name and the api port. Override either part via VITE_API_BASE /
# KANJISCRIBE_API_PORT when building.
VITE_API_BASE="${VITE_API_BASE:-http://raspberrypi:${KANJISCRIBE_API_PORT:-52654}}" pnpm --filter @kanjiscribe/web build

echo "Building API bundle..."
pnpm --filter @kanjiscribe/api build

echo ""
echo "Build complete!"
echo ""
echo "To release to production:"
echo "  ./scripts/release.sh release /media/default/ssd/prod/kanjiscribe"
echo ""
echo "Or run manually:"
echo "  KANJISCRIBE_API_PORT=52654 \\"
echo "  KANJISCRIBE_DATA_DIR=/media/default/ssd/prod/kanjiscribe/data \\"
echo "  node apps/api/dist/server.js"
