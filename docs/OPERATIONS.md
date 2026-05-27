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
   ```

4. Run the kiosk service:

   ```bash
   npm --workspace @frc-attendance/kiosk run service
   ```

## Fingerprint Reader Integration

The central backend never stores biometric templates. Each onboard-template reader should store and match templates locally, then emit only:

```text
STAT:ONLINE
STAT:OFFLINE
MATCH:<student_id>,<template_slot>
```

Replace the simulator in `apps/kiosk/fingerprint_bridge.py` with the selected reader library once hardware is finalized.

## Roster Sync

The member Google Sheet remains authoritative for active students and stable Student IDs. The API currently accepts normalized roster rows at `POST /admin/roster/sync`; the next implementation step is wiring this endpoint to a Google Sheets reader or an Apps Script push.

Removed roster entries are deactivated in D1 rather than deleted.
