#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"

mkdir -p "$SYSTEMD_USER_DIR"
cp "$ROOT_DIR/apps/kiosk/systemd/"*.service "$SYSTEMD_USER_DIR/"

systemctl --user daemon-reload
systemctl --user enable frc-bench-api.service frc-kiosk-service.service frc-kiosk-ui.service frc-dashboard-ui.service
systemctl --user restart frc-bench-api.service frc-kiosk-service.service frc-kiosk-ui.service frc-dashboard-ui.service

echo "Installed and started user services:"
systemctl --user --no-pager --full status frc-bench-api.service frc-kiosk-service.service frc-kiosk-ui.service frc-dashboard-ui.service || true
