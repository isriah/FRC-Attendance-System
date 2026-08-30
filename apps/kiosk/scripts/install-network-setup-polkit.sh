#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID}" -ne 0 ]; then
  echo "Run with sudo: sudo bash apps/kiosk/scripts/install-network-setup-polkit.sh" >&2
  exit 1
fi

KIOSK_USER="${SUDO_USER:-}"
if [ -z "$KIOSK_USER" ] || [ "$KIOSK_USER" = "root" ]; then
  echo "Run this through sudo from the kiosk account, not as a root login." >&2
  exit 1
fi

RULE_PATH="/etc/polkit-1/rules.d/49-frc-kiosk-network-setup.rules"

cat > "$RULE_PATH" <<EOF
// Allows the protected local FRC kiosk screen to scan and join Wi-Fi as ${KIOSK_USER}.
// It does not grant desktop, shell, sudo, or unrelated NetworkManager permissions.
polkit.addRule(function(action, subject) {
  var allowedActions = [
    "org.freedesktop.NetworkManager.network-control",
    "org.freedesktop.NetworkManager.wifi.scan",
    "org.freedesktop.NetworkManager.settings.modify.own",
    "org.freedesktop.NetworkManager.settings.modify.system"
  ];
  if (subject.user == "${KIOSK_USER}" && allowedActions.indexOf(action.id) >= 0) {
    return polkit.Result.YES;
  }
});
EOF

chmod 0644 "$RULE_PATH"
echo "Installed protected kiosk NetworkManager policy for ${KIOSK_USER}: $RULE_PATH"
