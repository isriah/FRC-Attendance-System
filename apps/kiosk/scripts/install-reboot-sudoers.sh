#!/usr/bin/env bash
set -euo pipefail

SUDOERS_FILE=/etc/sudoers.d/frc-attendance-reboot
SYSTEMCTL_PATH=${SYSTEMCTL_PATH:-/usr/bin/systemctl}
KIOSK_USER=${KIOSK_USER:-${SUDO_USER:-$USER}}

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash apps/kiosk/scripts/install-reboot-sudoers.sh" >&2
  exit 1
fi

printf '%s ALL=(root) NOPASSWD: %s reboot\n' "$KIOSK_USER" "$SYSTEMCTL_PATH" > "$SUDOERS_FILE"
chmod 0440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE"
echo "Installed reboot sudoers rule for $KIOSK_USER at $SUDOERS_FILE"
