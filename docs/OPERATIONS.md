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

To run the central API locally on the Pi or a laptop:

```bash
npm --workspace @frc-attendance/api run db:migrate:local
npx wrangler d1 execute frc-attendance --local --file apps/api/seed-local.sql
npm --workspace @frc-attendance/api run dev
```

The seed file creates:

- student `100001`
- kiosk `bench-01`
- kiosk token `dev-token`

With the API running at `http://localhost:8787`, the bench kiosk service command below should sync queued scans instead of reporting `fetch failed`.

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
   FINGERPRINT_SLOT_MAP='{"1":"100001"}'
   ```

4. Run the kiosk service:

   ```bash
   npm --workspace @frc-attendance/kiosk run service
   ```

## Fingerprint Reader Integration

The central backend never stores biometric templates. The kiosk bridge now talks to the R503-compatible reader through the Adafruit fingerprint library and emits only:

```text
STAT:ONLINE
STAT:OFFLINE
MATCH:<student_id>,<template_slot>
```

For bench testing, enroll a finger into slot `1`, map it to a fake student ID, and run:

```bash
FINGERPRINT_SLOT_MAP='{"1":"100001"}' \
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

The member Google Sheet remains authoritative for active students and stable Student IDs. The API currently accepts normalized roster rows at `POST /admin/roster/sync`; the next implementation step is wiring this endpoint to a Google Sheets reader or an Apps Script push.

Removed roster entries are deactivated in D1 rather than deleted.
