#!/usr/bin/env bash
# claudex desktop installer (macOS). Downloads the latest .dmg from GitHub
# Releases, installs claudex.app, and clears the Gatekeeper quarantine so it
# opens without the "unidentified developer" warning (the app is unsigned).
#
#   curl -fsSL https://github.com/ifelsetrueseal/claudex/releases/latest/download/install.sh | bash
set -euo pipefail

REPO="ifelsetrueseal/claudex"
APP="claudex"

if [ "$(uname)" != "Darwin" ]; then
  echo "This installer is for macOS only." >&2
  exit 1
fi

echo "→ Finding the latest $APP release…"
DMG_URL=$(
  curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
    | grep -oE '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+\.dmg"' \
    | head -1 \
    | sed -E 's/.*"(https[^"]+)".*/\1/'
)
if [ -z "${DMG_URL:-}" ]; then
  echo "No .dmg asset found in the latest release." >&2
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
DMG="$TMP/$APP.dmg"

echo "→ Downloading $DMG_URL"
curl -fsSL "$DMG_URL" -o "$DMG"

echo "→ Mounting…"
MOUNT="$(hdiutil attach "$DMG" -nobrowse -readonly | tail -1 | sed -E 's/.*(\/Volumes\/.*)$/\1/')"
if [ -z "${MOUNT:-}" ] || [ ! -d "$MOUNT/$APP.app" ]; then
  echo "Could not mount the disk image or find $APP.app inside." >&2
  exit 1
fi

# Prefer /Applications; fall back to ~/Applications if not writable.
DEST="/Applications"
[ -w "$DEST" ] || DEST="$HOME/Applications"
mkdir -p "$DEST"

echo "→ Installing to $DEST/$APP.app"
rm -rf "$DEST/$APP.app"
cp -R "$MOUNT/$APP.app" "$DEST/"
hdiutil detach "$MOUNT" -quiet || true

echo "→ Clearing Gatekeeper quarantine…"
xattr -dr com.apple.quarantine "$DEST/$APP.app" 2>/dev/null || true

echo "✅ Installed: $DEST/$APP.app"
echo "   Launch it from Launchpad/Spotlight, or: open \"$DEST/$APP.app\""
