# Raspberry Pi Kiosk Setup

This guide sets up a Raspberry Pi kiosk from a fresh Raspberry Pi OS Desktop image.

## 1. Image The Pi

Use Raspberry Pi Imager:

- OS: Raspberry Pi OS 64-bit with Desktop.
- Enable SSH.
- Set hostname, username, password, Wi-Fi, locale, and timezone.

For the current bench kiosk:

- user: `attkiosk`
- repo path: `~/FRC-Attendance-System`

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
systemctl --user status frc-bench-api frc-kiosk-service frc-kiosk-ui
curl http://localhost:8787/health
curl -I http://localhost:5173
```

Expected:

- bench API active on `http://localhost:8787`
- kiosk UI active on `http://localhost:5173`
- fingerprint service log says `Fingerprint reader online`

View logs:

```bash
journalctl --user -u frc-kiosk-service -f
```

## 8. Bench Fingerprint Mapping

Fingerprint templates stay on the sensor. The kiosk SQLite DB stores only the mapping from sensor template slot to Student ID.

To enroll a new finger into slot `1` and map it to student `100001`:

```bash
cd ~/FRC-Attendance-System
npm --workspace @frc-attendance/kiosk run fingerprint:enroll -- \
  --student-id 100001 \
  --slot 1 \
  --finger-label right-index
```

To map an already-enrolled slot without touching the sensor:

```bash
npm --workspace @frc-attendance/kiosk run fingerprint:map -- \
  --student-id 100001 \
  --slot 1 \
  --finger-label right-index
```

For the original bench test, slot `1` maps to:

```text
template slot 1 -> student 100001
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

## 9. Update Existing Kiosk

```bash
cd ~/FRC-Attendance-System
git pull
source ~/.nvm/nvm.sh
nvm use 22
npm install
npm rebuild better-sqlite3
bash apps/kiosk/scripts/install-user-services.sh
bash apps/kiosk/scripts/install-browser-autostart.sh
systemctl --user restart frc-bench-api frc-kiosk-service frc-kiosk-ui
```
