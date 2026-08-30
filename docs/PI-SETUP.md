# Raspberry Pi Kiosk Setup

This guide sets up a Raspberry Pi kiosk from a fresh Raspberry Pi OS Desktop image.

## 1. Image The Pi

Use Raspberry Pi Imager:

- OS: Raspberry Pi OS 64-bit with Desktop.
- Enable SSH.
- Set hostname, username, password, Wi-Fi, locale, and timezone.

For the current bench kiosk:

- user: `attkiosk`
- SSH target: `attkiosk@AttKiosk`
- repo path: `~/FRC-Attendance-System`

Always include the user when connecting from the Windows workstation:

```powershell
ssh attkiosk@AttKiosk
```

Plain `ssh AttKiosk` defaults to the local Windows username, which is not the Pi account.

## 2. Configure Display

For Waveshare 7inch DSI LCD (E), Raspberry Pi 4B:

```ini
dtoverlay=vc4-kms-v3d
dtoverlay=vc4-kms-dsi-waveshare-panel,8_0_inch
```

Add those lines to:

```bash
sudo nano /boot/firmware/config.txt
```

Reboot and confirm display and touch work.

## 3. Configure UART

Enable the Raspberry Pi serial hardware and disable login shell over serial:

```bash
sudo raspi-config
```

Choose:

```text
Interface Options -> Serial Port
Login shell over serial? No
Enable serial hardware? Yes
```

Reboot, then confirm:

```bash
ls -l /dev/serial0
cat /boot/firmware/cmdline.txt
```

`cmdline.txt` should not contain `console=serial0` or `console=ttyS0`.

## 4. Wire R503 Fingerprint Reader

Use the reader's actual pin labels, not wire colors.

```text
R503 VCC -> Pi 3.3V or module-specified VCC
R503 GND -> Pi GND
R503 TX  -> Pi RXD, GPIO15, physical pin 10
R503 RX  -> Pi TXD, GPIO14, physical pin 8
```

If the sensor does not respond, power off and swap TX/RX.

## 5. Clone Repo

```bash
git clone https://github.com/isriah/FRC-Attendance-System.git
cd FRC-Attendance-System
```

## 6. Run User Setup

The setup script installs user-local Node 22 with nvm, installs npm packages, rebuilds native SQLite bindings, installs Python fingerprint dependencies, installs user services, and installs Chromium autostart.

```bash
bash apps/kiosk/scripts/setup-pi-user.sh
```

Then run the one sudo command that cannot be done by the user script:

```bash
sudo loginctl enable-linger "$USER"
```

## 7. Verify Services

```bash
systemctl --user status frc-bench-api frc-kiosk-service frc-kiosk-ui frc-dashboard-ui
curl http://localhost:8787/health
curl -I http://localhost:5173
curl -I http://localhost:5174
```

Expected:

- bench API active on `http://localhost:8787`
- kiosk UI active on `http://localhost:5173`
- admin dashboard active on `http://localhost:5174`
- fingerprint service log says `Fingerprint reader online`
- kiosk service display state active on `http://localhost:8788/kiosk/display-state`
- dashboard Kiosks tab shows sync health, including reader state, pending queued scans, and the latest sync error when connectivity is failing

The admin dashboard Kiosks tab includes remote command buttons for each active kiosk:

- `Restart display`: restarts `frc-kiosk-ui`.
- `Restart services`: restarts `frc-bench-api`, `frc-kiosk-ui`, `frc-dashboard-ui`, then schedules `frc-kiosk-service` to restart itself.
- `Reboot system`: schedules `sudo -n systemctl reboot`. This requires passwordless sudo permission for the kiosk user.

The kiosk service polls the configured API for these commands every `KIOSK_COMMAND_POLL_SECONDS`, default `10`.

The kiosk display polls the kiosk service display-state endpoint on port `8788` first, with a fallback to the local bench API on port `8787`. This keeps the display responsive when the fingerprint service syncs scans to the remote Worker instead of the local bench API.

To enable the reboot command, install the narrow sudoers rule once on the Pi:

```bash
cd ~/FRC-Attendance-System
sudo bash apps/kiosk/scripts/install-reboot-sudoers.sh
```

This allows the kiosk user to run only `/usr/bin/systemctl reboot` without an interactive password. Without this rule, reboot commands are reported as failed instead of silently claiming success.

View logs:

```bash
journalctl --user -u frc-kiosk-service -f
```

## 8. Basic Kiosk Styling

The kiosk UI supports simple branding through the `frc-kiosk-ui.service` environment:

```ini
Environment="VITE_KIOSK_TITLE=FRC Attendance"
Environment="VITE_KIOSK_SUBTITLE=RoboLancers 321"
Environment="VITE_KIOSK_PRIMARY_COLOR=#B80100"
Environment="VITE_KIOSK_ACCENT_COLOR=#f2c14e"
```

The rest of the kiosk palette is derived automatically from those two colors.

After editing the service file, reload and restart:

```bash
systemctl --user daemon-reload
systemctl --user restart frc-kiosk-ui
```

## 9. Touch Network Setup and Offline Boot

The kiosk remains in Chromium full-screen mode during normal attendance use. Its
connection icon in the upper-left is green for a working local network, yellow
when scans are queued, and red when no connection is available. To prevent
accidental student use, hold that icon for three seconds to open Network
settings.

At boot, if neither wired Ethernet nor Wi-Fi is connected, the kiosk opens the
same touch-friendly Wi-Fi setup screen automatically instead of leaving the
operator trapped at an offline attendance screen. Choose an SSID, enter its
password with the built-in on-screen keyboard, and tap `Connect`; attendance
returns automatically after NetworkManager confirms the connection. The screen
can also be used to refresh the visible Wi-Fi list. It does not expose the
desktop, terminal, saved passwords, or arbitrary system settings.

This flow uses Raspberry Pi OS Desktop's NetworkManager command-line client.
Current Raspberry Pi OS Desktop images include it. If `nmcli` is missing, an
administrator must install and enable NetworkManager once:

```bash
sudo apt install -y network-manager
sudo systemctl enable --now NetworkManager
```

The kiosk account needs the standard active desktop session that Raspberry Pi
OS grants to create its own Wi-Fi connections. The kiosk service intentionally
runs without an interactive terminal, so install the repository's narrow
NetworkManager Polkit rule once; it grants only Wi-Fi scan/connect actions to
the kiosk account and does not grant desktop or sudo access:

```bash
cd ~/FRC-Attendance-System
sudo bash apps/kiosk/scripts/install-network-setup-polkit.sh
```

Validate before deployment:

```bash
nmcli general permissions
nmcli device status
```

Do not put Wi-Fi passwords in service files or the repository. The local setup
endpoint is loopback-only and passes a submitted password directly to
NetworkManager without logging or storing it in kiosk code.

The first manual long-press opens a private on-kiosk flow to choose and confirm
a 6-to-12 digit network-settings PIN. Later manual long-presses require that
PIN before showing the Wi-Fi screen. The Pi stores only a salted scrypt verifier
next to its kiosk SQLite cache (mode `0600`), never the PIN itself. Offline boot
setup remains available without a PIN so an unconnected kiosk can be recovered.
An authenticated dashboard administrator (not a mentor/operator) can queue
**Reset network PIN** from the Kiosks view. That one-time command only clears
the local verifier when the kiosk polls it; the replacement PIN is chosen on
the kiosk and is never sent through the dashboard or API.

## 10. Minimal Roster Import

For v1, the roster only needs:

```text
memberId,firstName,lastName
100001,Bench,Member
```

Open the dashboard at `http://<pi-hostname-or-ip>:5174`, go to the roster tab, and paste CSV with those three columns. The central API stores `memberId` as `student_id` for attendance-event compatibility.

## 11. Bench Fingerprint Mapping

Fingerprint templates stay on the sensor. The kiosk SQLite DB stores only the mapping from sensor template slot to Member ID. Existing local columns are still named `student_id` for compatibility.

The normal path is the dashboard:

1. Open `http://<pi-hostname-or-ip>:5174`.
2. Go to the roster tab.
3. Select an active member, use the suggested next available slot or choose another unused slot, and click `Enroll fingerprint`.

The dashboard shows the current local slot mappings, warns before overwriting an occupied slot, can save a mapping without touching the sensor, and can remove a mapping while leaving the sensor template intact. The dashboard temporarily stops the kiosk scanning service, runs enrollment against the local reader, saves the slot mapping, and restarts scanning.

To enroll a new finger into slot `1` and map it to member `100001`:

```bash
cd ~/FRC-Attendance-System
npm --workspace @frc-attendance/kiosk run fingerprint:enroll -- \
  --member-id 100001 \
  --slot 1 \
  --finger-label right-index
```

To map an already-enrolled slot without touching the sensor:

```bash
npm --workspace @frc-attendance/kiosk run fingerprint:map -- \
  --member-id 100001 \
  --slot 1 \
  --finger-label right-index
```

For the original bench test, slot `1` maps to:

```text
template slot 1 -> member 100001
```

The mapping is stored in:

```text
apps/kiosk/kiosk-cache.sqlite
```

The service reads this DB path from:

```ini
Environment=KIOSK_DB_PATH=%h/FRC-Attendance-System/apps/kiosk/kiosk-cache.sqlite
```

After changing enrollment mappings, restart the service:

```bash
systemctl --user restart frc-kiosk-service
```

## 12. Update Existing Kiosk

From the Windows workstation, connect as:

```powershell
ssh attkiosk@AttKiosk
```

Then run on the Pi:

```bash
cd ~/FRC-Attendance-System
git pull
source ~/.nvm/nvm.sh
nvm use 22
npm ci
npm rebuild better-sqlite3
bash apps/kiosk/scripts/install-user-services.sh
bash apps/kiosk/scripts/install-browser-autostart.sh
systemctl --user restart frc-bench-api frc-kiosk-service frc-kiosk-ui frc-dashboard-ui
```

Use `npm ci` rather than `npm install` on the Pi. `npm install` can rewrite
`package-lock.json` when the Pi's npm/platform metadata differs from the
development machine, which leaves the kiosk checkout dirty. If the Pi shows
`package-lock.json` as modified after an install-only operation, restore it,
rerun `npm ci`, rebuild `better-sqlite3`, and confirm `git status --short`
is clean. The repository should also report zero tracked dependency files:

```bash
git ls-files "*node_modules*" | wc -l
```
