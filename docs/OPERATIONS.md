# Operations Guide

## Cloudflare Setup

1. Create a D1 database:

   ```bash
   npx wrangler d1 create frc-attendance
   ```

2. Copy the generated database ID into `apps/api/wrangler.toml`.
3. Apply migrations:

   ```bash
   npm --workspace @frc-attendance/api run db:migrate
   ```

4. Configure Worker variables:

   - `TIME_ZONE`: default `America/New_York`.
   - `GOOGLE_CLIENT_ID`: Google OAuth client ID for the dashboard.
   - `GOOGLE_ALLOWED_EMAILS`: comma-separated mentor emails.
   - `GOOGLE_ALLOWED_DOMAIN`: optional Google Workspace domain.
   - `DUPLICATE_WINDOW_SECONDS`: default `90`.

## Local API Bench Test

Wrangler's local D1 emulator can be heavy on Raspberry Pi. For hardware bench testing, use the lightweight local API instead:

```bash
npm --workspace @frc-attendance/api run dev:bench
```

It listens on `http://localhost:8787` and seeds:

- student `100001`
- kiosk `bench-01`
- kiosk token `dev-token`

With that API running, the bench kiosk service command below should sync queued scans instead of reporting `fetch failed`.

To run the real Cloudflare Worker locally on a laptop:

```bash
npm --workspace @frc-attendance/api run db:migrate:local
npx wrangler d1 execute frc-attendance --local --file apps/api/seed-local.sql
npm --workspace @frc-attendance/api run dev
```

## Dashboard

Deploy `apps/dashboard` to Cloudflare Pages. Set:

- `VITE_API_BASE_URL`: deployed Worker URL.
- `VITE_GOOGLE_CLIENT_ID`: same OAuth client ID configured for the API.

For local development only, if no Google client ID is configured, the dashboard can send an `x-admin-email` header and the API will still enforce the configured allowlist.

## Kiosk Provisioning

1. Register a kiosk from the dashboard or by calling `POST /admin/kiosks`.
2. Store the raw kiosk token only on the Raspberry Pi.
3. Set kiosk environment variables:

   ```bash
   KIOSK_ID=shop-entrance
   KIOSK_TOKEN=<raw-token>
   API_BASE_URL=https://frc-attendance-api.example.workers.dev
   KIOSK_DB_PATH=/var/lib/frc-attendance/kiosk-cache.sqlite
   PYTHON_PATH=python3
   FINGERPRINT_BRIDGE_PATH=/opt/frc-attendance/fingerprint_bridge.py
   FINGERPRINT_SERIAL_PORT=/dev/serial0
   FINGERPRINT_BAUDRATE=57600
   FINGERPRINT_DEBOUNCE_SECONDS=8
   ```

4. Run the kiosk service:

   ```bash
   npm --workspace @frc-attendance/kiosk run service
   ```

## Pi User Services

For a fresh Pi, prefer the full setup guide in `docs/PI-SETUP.md`.

For bench testing without sudo, install user-level systemd services:

```bash
cd ~/FRC-Attendance-System
bash apps/kiosk/scripts/install-user-services.sh
bash apps/kiosk/scripts/install-browser-autostart.sh
```

This installs and starts:

- `frc-bench-api.service`: lightweight local API on `http://localhost:8787`.
- `frc-kiosk-service.service`: fingerprint bridge and offline queue sync.
- `frc-kiosk-ui.service`: kiosk UI dev server on `http://localhost:5173`.

Useful commands:

```bash
systemctl --user status frc-bench-api frc-kiosk-service frc-kiosk-ui
journalctl --user -u frc-kiosk-service -f
systemctl --user restart frc-kiosk-service
```

To keep user services running after logout, run this once with sudo:

```bash
sudo loginctl enable-linger attkiosk
```

## Fingerprint Reader Integration

The central backend never stores biometric templates. The kiosk bridge now talks to the R503-compatible reader through the Adafruit fingerprint library and emits only:

```text
STAT:ONLINE
STAT:OFFLINE
MATCH:<student_id>,<template_slot>
```

For bench testing, enroll or map a finger into slot `1`:

```bash
npm --workspace @frc-attendance/kiosk run fingerprint:map -- \
  --student-id 100001 \
  --slot 1
```

Then run:

```bash
KIOSK_ID=bench-01 \
KIOSK_TOKEN=dev-token \
API_BASE_URL=http://localhost:8787 \
npm --workspace @frc-attendance/kiosk run service
```

Expected while the API is not running:

```text
Fingerprint reader online
Queued scan <uuid> for student 100001
Offline or sync failed; scan remains cached: fetch failed
```

Set `FINGERPRINT_SIMULATE=true` to run without hardware. Repeated matches for the same template slot are suppressed for `FINGERPRINT_DEBOUNCE_SECONDS`, default `8`.

## Roster Sync

The member Google Sheet remains authoritative for active members and stable Member IDs. The API currently accepts normalized roster rows at `POST /admin/roster/sync` with `memberId`, `firstName`, and `lastName`; the next implementation step is wiring this endpoint to a Google Sheets reader or an Apps Script push.

Removed roster entries are deactivated in D1 rather than deleted.
