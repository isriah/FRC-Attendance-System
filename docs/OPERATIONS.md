# Operations Guide

## Cloudflare Setup

Current production API:

- Worker URL: `https://frc-attendance-api.frc-attendance.workers.dev`
- D1 database: `frc-attendance`
- D1 database ID: `c02c0ca8-033b-435f-ae21-2d8f3b203b22`
- Workers account subdomain: `frc-attendance.workers.dev`
- Registered bench kiosk: `bench-01`

Current production dashboard:

- Cloudflare Pages project: `frc-attendance-dashboard`
- Pages URL: `https://frc-attendance-dashboard.pages.dev`
- Latest verified deployment: `https://933d1d20.frc-attendance-dashboard.pages.dev`
- API base URL baked into the uploaded Vite build: `https://frc-attendance-api.frc-attendance.workers.dev`
- Google OAuth client ID baked into the uploaded Vite build: `180849199739-v04bktp7rfmimgjpvohmq7pinrrpr337.apps.googleusercontent.com`

Before applying remote migrations or deploying the Worker, run:

```bash
npm --workspace @frc-attendance/api run check:deploy-config
```

This preflight fails until `apps/api/wrangler.toml` has a real D1 `database_id`, a production `GOOGLE_CLIENT_ID`, and either `GOOGLE_ALLOWED_EMAILS` or `GOOGLE_ALLOWED_DOMAIN`.

1. Create a D1 database:

   ```bash
   npx wrangler d1 create frc-attendance
   ```

2. Copy the generated database ID into `apps/api/wrangler.toml`.
3. Register a `workers.dev` account subdomain in Cloudflare Workers & Pages if the account does not already have one.
4. Apply remote migrations:

   ```bash
   npm --workspace @frc-attendance/api run db:migrate
   ```

5. Configure Worker variables before deploying:

   - `TIME_ZONE`: default `America/New_York`.
   - `GOOGLE_CLIENT_ID`: Google OAuth client ID for the dashboard.
   - `GOOGLE_ALLOWED_EMAILS`: comma-separated mentor emails.
   - `GOOGLE_ALLOWED_DOMAIN`: optional Google Workspace domain.
   - `DUPLICATE_WINDOW_SECONDS`: default `90`.

6. Deploy the Worker:

   ```bash
   npm --workspace @frc-attendance/api run deploy
   ```

7. Verify the deployed health endpoint:

   ```bash
   curl https://frc-attendance-api.frc-attendance.workers.dev/health
   ```

   Expected response:

   ```json
   { "ok": true, "service": "frc-attendance-api" }
   ```

   On this Windows workstation, the default HTTPS check may try a failing IPv6/TLS path. If that happens, force IPv4:

   ```powershell
   curl.exe -4 https://frc-attendance-api.frc-attendance.workers.dev/health
   ```

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

`apps/dashboard` is deployed to Cloudflare Pages project `frc-attendance-dashboard`.

For direct uploads, build with production Vite variables before deploying:

```powershell
$env:VITE_API_BASE_URL='https://frc-attendance-api.frc-attendance.workers.dev'
$env:VITE_GOOGLE_CLIENT_ID='180849199739-v04bktp7rfmimgjpvohmq7pinrrpr337.apps.googleusercontent.com'
npm.cmd --workspace @frc-attendance/dashboard run build
npx.cmd wrangler pages deploy apps/dashboard/dist --project-name frc-attendance-dashboard --branch main --commit-dirty=true
```

Production values:

- `VITE_API_BASE_URL`: `https://frc-attendance-api.frc-attendance.workers.dev`.
- `VITE_GOOGLE_CLIENT_ID`: `180849199739-v04bktp7rfmimgjpvohmq7pinrrpr337.apps.googleusercontent.com`.

Verification completed on 2026-05-28:

- Dashboard production build completed successfully.
- Cloudflare Pages deployment completed for project `frc-attendance-dashboard`.
- `https://frc-attendance-dashboard.pages.dev` returned HTTP 200.
- Uploaded dashboard JS contains the production Worker URL and Google OAuth client ID.
- Headless Chrome loaded the Pages URL, fetched `https://accounts.google.com/gsi/client`, and rendered the Google sign-in button.
- Worker health returned `{ "ok": true, "service": "frc-attendance-api" }`.
- API CORS preflight from the Pages origin allowed `authorization`, `content-type`, and `x-admin-email`.
- Unauthenticated admin API access returned `401 Missing admin identity`, confirming the deployed API requires a Google bearer token when `GOOGLE_CLIENT_ID` is configured.

Interactive Google sign-in was fixed by adding the deployed Pages origin to the Google OAuth client's Authorized JavaScript origins:

- `https://frc-attendance-dashboard.pages.dev`

Credentialed Google admin access was verified after signing in as the allowlisted Google account. The dashboard now loads admin pages successfully against the deployed Worker.

Deployment `https://9c9f9dd1.frc-attendance-dashboard.pages.dev` also hardens stale-session handling so the production dashboard only enters the app with a Google ID token and does not use the local `x-admin-email` fallback when `VITE_GOOGLE_CLIENT_ID` is configured.

Deployment `https://c1a584ae.frc-attendance-dashboard.pages.dev` adds per-kiosk remote command buttons on the Kiosks tab. The associated Worker deployment applied D1 migration `0002_kiosk_commands.sql` and exposes admin command creation plus kiosk command polling/completion endpoints.

Deployment `https://933d1d20.frc-attendance-dashboard.pages.dev` shows recent queued/running/completed/failed kiosk command results per kiosk. The associated Worker deployment exposes `GET /admin/kiosk-commands` for credentialed dashboard command-history reads.

The dashboard login UI follows the same boundary: when `VITE_GOOGLE_CLIENT_ID` is configured, it shows Google sign-in and a production notice that email-only local login is disabled. The email-only form is rendered only for local development builds with no Google client ID.

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
   KIOSK_COMMAND_POLL_SECONDS=10
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

Current bench Pi production API validation:

- Hostname: `AttKiosk`
- Kiosk ID: `bench-01`
- API base URL: `https://frc-attendance-api.frc-attendance.workers.dev`
- The raw kiosk token remains only on the Pi. Remote D1 stores only its SHA-256 hash.
- On 2026-05-28, `bench-01` was registered in remote D1 and the installed user service was pointed at the deployed Worker with this user-service drop-in:

  ```ini
  # ~/.config/systemd/user/frc-kiosk-service.service.d/remote-worker.conf
  [Service]
  Environment=API_BASE_URL=https://frc-attendance-api.frc-attendance.workers.dev
  ```

- Offline queue replay was validated by stopping `frc-kiosk-service`, inserting one pending local fingerprint scan for student `100001`, restarting the service, and confirming the local event `remote-replay-1de1a877-fa2c-482f-b388-335758e663de` was marked synced locally and inserted into remote D1 as an accepted `scan_events` row.
- The dashboard Kiosks tab can queue per-kiosk restart commands. Kiosk services poll `GET /kiosk/commands` with their kiosk token and execute only allowlisted local actions: restart display (`frc-kiosk-ui`), restart kiosk services (`frc-bench-api`, `frc-kiosk-ui`, `frc-dashboard-ui`, then `frc-kiosk-service`), or schedule a system reboot with `sudo -n /usr/bin/systemctl reboot`. Reboot commands require the narrow sudoers rule installed by `sudo bash apps/kiosk/scripts/install-reboot-sudoers.sh`.

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
- `frc-kiosk-service.service` also polls the configured API for remote kiosk commands every `KIOSK_COMMAND_POLL_SECONDS`, default `10`.

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
