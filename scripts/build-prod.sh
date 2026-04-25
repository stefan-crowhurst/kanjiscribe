#!/bin/bash
set -e

echo "Building Kanjiscribe for production..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "Installing dependencies..."
pnpm install

echo "Building shared package..."
pnpm --filter @kanjiscribe/shared build

echo "Building webapp (production mode - same-origin API)..."
VITE_API_BASE="" pnpm --filter @kanjiscribe/web build

echo "Building API bundle..."
pnpm --filter @kanjiscribe/api build

echo ""
echo "Build complete!"
echo ""
echo "To deploy to production:"
echo "  ./scripts/deploy.sh /media/default/ssd/prod/kanjiscribe"
echo ""
echo "Or run manually:"
echo "  KANJISCRIBE_API_PORT=52654 \\"
echo "  KANJISCRIBE_DATA_DIR=/media/default/ssd/prod/kanjiscribe/data \\"
echo "  node apps/api/dist/server.js"
