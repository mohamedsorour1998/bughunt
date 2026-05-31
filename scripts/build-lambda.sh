#!/bin/bash
# Build the leaderboard-updater Lambda function
# Produces lambda/leaderboard-updater/dist/index.js

set -euo pipefail

LAMBDA_DIR="$(cd "$(dirname "$0")/../lambda/leaderboard-updater" && pwd)"

echo "Installing Lambda dependencies..."
cd "$LAMBDA_DIR"
npm install --omit=dev 2>/dev/null || npm install

echo "Compiling TypeScript..."
npm run build

echo ""
echo "Build complete: $LAMBDA_DIR/dist/index.js"
echo ""
echo "To package for deployment:"
echo "  cd $LAMBDA_DIR && zip -r ../../lambda-leaderboard-updater.zip dist/ node_modules/"
