#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="com.sfgrimes.pipewire-audio"
STAGE_DIR="${PLUGIN_NAME}.sdPlugin"

cd "$(dirname "$0")"

VERSION=$(node -e "process.stdout.write(require('./manifest.json').Version)")
OUTPUT="builds/${PLUGIN_NAME}-${VERSION}.streamDeckPlugin"
echo "Version: $VERSION"

echo "Installing dependencies..."
npm install --omit=dev

echo "Packaging plugin..."

# Create staging directory with the expected .sdPlugin name
rm -rf "$STAGE_DIR"
mkdir "$STAGE_DIR"

# Copy only plugin files into it
cp -r icons node_modules propertyInspector "$STAGE_DIR/"
cp index.js pipewire.js manifest.json package.json package-lock.json "$STAGE_DIR/"

# Build the zip with the .sdPlugin directory as the top-level entry
rm -f "$OUTPUT"
mkdir -p builds ; zip -r "$OUTPUT" "$STAGE_DIR"

# Clean up staging directory
rm -rf "$STAGE_DIR"

echo "Built: $OUTPUT"
ls -lh "$OUTPUT"
