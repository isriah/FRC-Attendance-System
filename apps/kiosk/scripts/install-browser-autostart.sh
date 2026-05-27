#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
AUTOSTART_DIR="$HOME/.config/autostart"

mkdir -p "$AUTOSTART_DIR"
cp "$ROOT_DIR/apps/kiosk/autostart/frc-kiosk-browser.desktop" "$AUTOSTART_DIR/"

echo "Installed Chromium kiosk autostart:"
echo "$AUTOSTART_DIR/frc-kiosk-browser.desktop"
