#!/usr/bin/env bash
set -euo pipefail

NODE_VERSION="${NODE_VERSION:-22}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required. Install with: sudo apt install -y git"
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required. Install with: sudo apt install -y curl"
  exit 1
fi

if [ ! -d "$HOME/.nvm" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi

# shellcheck source=/dev/null
source "$HOME/.nvm/nvm.sh"
nvm install "$NODE_VERSION"
nvm alias default "$NODE_VERSION"
nvm use "$NODE_VERSION" >/dev/null

npm install
npm rebuild better-sqlite3

python3 -m pip install pyserial adafruit-circuitpython-fingerprint --break-system-packages

bash apps/kiosk/scripts/install-user-services.sh
bash apps/kiosk/scripts/install-browser-autostart.sh

cat <<'EOF'

Pi user setup complete.

Run this once with sudo so user services start before SSH/desktop login:

  sudo loginctl enable-linger "$USER"

Also confirm Raspberry Pi UART is enabled and serial console is disabled:

  sudo raspi-config
  Interface Options -> Serial Port
  Login shell over serial? No
  Enable serial hardware? Yes

EOF
