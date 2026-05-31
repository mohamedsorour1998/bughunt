#!/bin/bash
set -e
echo "Building VS Code extension..."
cd vscode-extension
npm install
npx esbuild src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node
# Package as .vsix
npx @vscode/vsce package --no-dependencies
echo "Extension packaged successfully."
