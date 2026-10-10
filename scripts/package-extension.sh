#!/bin/bash
# package-extension.sh — Creates a clean ZIP for Chrome Web Store submission
# Usage: ./scripts/package-extension.sh

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
EXTENSION_ROOT="$PROJECT_ROOT/extension"

EXTENSION_NAME="reqkit"
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('$EXTENSION_ROOT/manifest.json', 'utf8')).version")
OUTPUT="${EXTENSION_NAME}-v${VERSION}.zip"

RUNTIME_FILES=(
  "manifest.json"
  "background.js"
  "background"
  "popup"
  "options"
  "privacy"
  "shared"
  "icons/reqkit-16.png"
  "icons/reqkit-32.png"
  "icons/reqkit-48.png"
  "icons/reqkit-128.png"
)

TEMP_DIR=$(mktemp -d)
TEMP_OUTPUT="$TEMP_DIR/$OUTPUT"
trap 'rm -rf "$TEMP_DIR"' EXIT

node "$PROJECT_ROOT/scripts/build-privacy.mjs"

# Package from the extension root so manifest.json is at the ZIP root. The
# allowlist keeps tests, documentation, and store artwork out of the upload.
cd "$EXTENSION_ROOT"
zip -X -r "$TEMP_OUTPUT" "${RUNTIME_FILES[@]}"
unzip -t "$TEMP_OUTPUT"
mv -f "$TEMP_OUTPUT" "$PROJECT_ROOT/$OUTPUT"

echo ""
echo "Packaged: $OUTPUT ($(du -h "$PROJECT_ROOT/$OUTPUT" | cut -f1))"
echo "   Version: $VERSION"
echo ""
echo "Files included:"
unzip -Z1 "$PROJECT_ROOT/$OUTPUT" | sed 's/^/   /'
