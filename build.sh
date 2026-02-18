#!/usr/bin/env bash
set -euo pipefail

PLUGIN_NAME="com.sfgrimes.pipewire-audio"
STAGE_DIR="${PLUGIN_NAME}.sdPlugin"

cd "$(dirname "$0")"

# Bump patch version in manifest.json and package.json
NEW_VERSION=$(node -e "
  const fs = require('fs');
  const m = JSON.parse(fs.readFileSync('manifest.json'));
  const p = JSON.parse(fs.readFileSync('package.json'));
  const parts = m.Version.split('.');
  parts[2] = String(Number(parts[2]) + 1);
  const v = parts.join('.');
  m.Version = v; p.version = v;
  fs.writeFileSync('manifest.json', JSON.stringify(m, null, 2) + '\n');
  fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
  process.stdout.write(v);
")
OUTPUT="builds/${PLUGIN_NAME}-${NEW_VERSION}.streamDeckPlugin"
echo "Version: $NEW_VERSION"

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
