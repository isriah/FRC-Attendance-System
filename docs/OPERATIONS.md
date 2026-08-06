# Operations Guide

## Cloudflare Setup

Current production API:

- Worker URL: `https://frc-attendance-api.frc-attendance.workers.dev`
- Latest deployed Worker version: `feac70c2-3656-453d-af06-2a434818a827`
- D1 database: `frc-attendance`
- D1 database ID: `c02c0ca8-033b-435f-ae21-2d8f3b203b22`
- Applied remote migrations: `0001_initial.sql` through `0005_student_email.sql`
- Workers account subdomain: `frc-attendance.workers.dev`
- Registered bench kiosk: `bench-01`

Current production dashboard:

- Cloudflare Pages project: `frc-attendance-dashboard`
- Pages URL: `https://frc-attendance-dashboard.pages.dev`
- Latest verified deployment: `https://1e14595e.frc-attendance-dashboard.pages.dev`
- API base URL baked into the uploaded Vite build: `https://frc-attendance-api.frc-attendance.workers.dev`
- Google OAuth client ID baked into the uploaded Vite build: `180849199739-v04bktp7rfmimgjpvohmq7pinrrpr337.apps.googleusercontent.com`

Before applying remote migrations or deploying the Worker, run:

```bash
npm --workspace @frc-attendance/api run check:deploy-config
```

This preflight fails until `apps/api/wrangler.toml` has a real D1 `database_id`, a production `GOOGLE_CLIENT_ID`, and either `GOOGLE_ALLOWED_EMAILS` or `GOOGLE_ALLOWED_DOMAIN` for bootstrap admin access.

Before deploying production changes, run the full smoke checklist from the workstation:

```powershell
npm.cmd run smoke:predeploy
```

This repeatable check verifies the production Worker `/health` response, verifies the deployed dashboard Pages app serves and contains the production API URL plus Google sign-in configuration, then runs the Pi-local roster pull smoke check over `ssh attkiosk@AttKiosk`. Override `PRODUCTION_API_BASE_URL`, `DASHBOARD_URL`, `EXPECTED_GOOGLE_CLIENT_ID`, or `PI_ROSTER_PULL_SSH_TARGET` when validating a different environment. Set `PREDEPLOY_SKIP_PI=1` or pass `-- --skip-pi` only when the bench Pi is intentionally unavailable.

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
   - `GOOGLE_ALLOWED_EMAILS`: comma-separated bootstrap mentor emails.
   - `GOOGLE_ALLOWED_DOMAIN`: optional bootstrap Google Workspace domain.
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

- member `100001`
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

Current feature-completion priority: validate the deployed mentor-ready reporting workflows with real roster data, then polish report/export formatting or Google Sheets integration from mentor feedback. Production now includes scheduled meeting summaries, zero-scan required meeting accounting, per-meeting absence drilldowns, roster-wide attendance summaries, date range filters, mentor-facing export ranges, database-backed dashboard admin access, dashboard theme controls, and matching local bench API routes.

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

Deployment `https://b279a659.frc-attendance-dashboard.pages.dev` shows kiosk sync health from `POST /kiosk/health`, including reader online/offline state, pending local scan count, latest successful sync time, and latest sync error. The associated Worker deployment applied D1 migration `0003_kiosk_health.sql`.

Deployment `https://7ee08968.frc-attendance-dashboard.pages.dev` adds a Pi-local roster action that pulls the active production Worker roster into the local bench SQLite roster. The associated Worker deployment exposes authenticated kiosk roster export at `GET /kiosk/roster`.

Deployment `https://47a22129.frc-attendance-dashboard.pages.dev` adds scheduled meeting management, recurring meeting creation, required/optional meeting reporting, scheduled meeting export data, and local bench API parity. Worker version `0a95704d-411d-423d-b3fd-a188ab06ea1c` applied remote D1 migration `0004_scheduled_meetings.sql`. The full predeploy smoke check passed on 2026-08-05, including Pi-local roster pull for `bench-01` with `synced: 4`.

Deployment `https://77d95a08.frc-attendance-dashboard.pages.dev` keeps meetings date-based with time-only start/end fields, defaults new meetings to `Regular Meeting` from 3:00 PM to 5:30 PM, hides notes during meeting creation, and keeps notes editable later. Worker version `c83e53b6-eca7-4b9d-a904-3b746db7a311` rejects direct API requests whose start/end timestamps fall outside the meeting date. Production Worker/dashboard smoke passed on 2026-08-05 with Pi skipped.

Deployment `https://d3404d23.frc-attendance-dashboard.pages.dev` combines single and repeating meeting creation into one Meetings form. The recurrence controls stay hidden until `Repeats` is checked. Production Worker/dashboard smoke passed on 2026-08-05 with Pi skipped.

Deployment `https://f54beeb0.frc-attendance-dashboard.pages.dev` fixes the Meetings page responsive layout so the page no longer creates document-level horizontal overflow at split-screen widths. Production Worker/dashboard smoke passed on 2026-08-05 with Pi skipped.

Deployment `https://d3e231ec.frc-attendance-dashboard.pages.dev` adds mentor-ready scheduled meeting reports: meeting summaries, absence drilldowns, roster-wide attendance summaries, date range filtering, and mentor-facing export ranges. Worker version `080db658-3ca5-4e8c-93c0-69414104ad64` exposes the matching report endpoints. Production Worker/dashboard smoke passed on 2026-08-05 with Pi skipped.

Deployment `https://e0927eea.frc-attendance-dashboard.pages.dev` adds a month calendar to the Meetings page, shows report-backed present/absent counts in the scheduled meetings list, and lets mentors select a meeting to review present members, absent members, and attendance stats. Production Worker/dashboard smoke passed on 2026-08-05 with Pi skipped.

Deployment `https://6e372c01.frc-attendance-dashboard.pages.dev` formats selected meeting check-in/check-out values as local times in the Meetings detail panel. Production Worker/dashboard smoke passed on 2026-08-05 with Pi skipped.

Deployment `https://226ac57b.frc-attendance-dashboard.pages.dev` makes Calendar the default Meetings view, moves the full scheduled-meetings table to an All Meetings tab, moves add/edit controls to an Add Meeting/Edit Meeting tab, and keeps selected meeting details with edit/delete controls in the calendar view. Production Worker/dashboard smoke passed on 2026-08-05 with Pi skipped.

Deployment `https://ee7ef476.frc-attendance-dashboard.pages.dev` makes absent members explicit in selected meeting details, with required-meeting absence counts, loading and empty states, and optional-meeting present-only guidance. Production Worker/dashboard smoke passed on 2026-08-06 with Pi skipped.

Deployment `https://1e14595e.frc-attendance-dashboard.pages.dev` adds database-backed dashboard admin management, optional roster member emails, dashboard Themed/Light/Dark modes, improved vertical spacing, and compact human-readable meeting detail tables. Worker version `feac70c2-3656-453d-af06-2a434818a827` applied remote D1 migration `0005_student_email.sql` and authorizes active `admin_users` emails alongside bootstrap env allowlist/domain access. Production Worker/dashboard smoke passed on 2026-08-06 with Pi skipped.

The dashboard login UI follows the same boundary: when `VITE_GOOGLE_CLIENT_ID` is configured, it shows Google sign-in and a production notice that email-only local login is disabled. The email-only form is rendered only for local development builds with no Google client ID.

For local development only, if no Google client ID is configured, the dashboard can send an `x-admin-email` header and the API will still enforce the configured allowlist.

Dashboard admin access is authorized when any of these are true:

- the signed-in email is active in the D1 `admin_users` table
- the signed-in email is listed in `GOOGLE_ALLOWED_EMAILS`
- the signed-in email matches `GOOGLE_ALLOWED_DOMAIN`

The env allowlist/domain are retained as bootstrap access so an existing deployment can create database-backed admins from the dashboard. If an email has an `admin_users` row with `active = 0`, that user is blocked even if an env allowlist or domain would otherwise match. Successful admin requests update `admin_users.last_login_at`; allowlisted/domain users without a row are inserted as active `mentor` users on first successful request.

Dashboard admins can manage database-backed OAuth access from the Admins tab by email, active status, and `mentor`/`admin` role. The role is stored for policy and audit use; current dashboard routes require an authenticated active admin but do not yet restrict actions by role.

Dashboard roster records can store an optional member email for user association. That member email does not grant dashboard admin access by itself; add the email on the Admins tab or keep it covered by the Worker env allowlist/domain.

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
- SSH target: `attkiosk@AttKiosk`. Use the account-qualified target; plain `ssh AttKiosk` uses the local workstation username and can fail even when the key is authorized for `attkiosk`.
- Kiosk ID: `bench-01`
- API base URL: `https://frc-attendance-api.frc-attendance.workers.dev`
- The raw kiosk token remains only on the Pi. Remote D1 stores only its SHA-256 hash.
- On 2026-05-28, `bench-01` was registered in remote D1 and the installed user service was pointed at the deployed Worker with this user-service drop-in:

  ```ini
  # ~/.config/systemd/user/frc-kiosk-service.service.d/remote-worker.conf
  [Service]
  Environment=API_BASE_URL=https://frc-attendance-api.frc-attendance.workers.dev
  ```

- Offline queue replay was validated by stopping `frc-kiosk-service`, inserting one pending local fingerprint scan for member `100001`, restarting the service, and confirming the local event `remote-replay-1de1a877-fa2c-482f-b388-335758e663de` was marked synced locally and inserted into remote D1 as an accepted `scan_events` row.
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
- `frc-kiosk-service.service`: fingerprint bridge, offline queue sync, local display state on `http://localhost:8788/kiosk/display-state`, and API health reporting.
- `frc-kiosk-ui.service`: kiosk UI dev server on `http://localhost:5173`.
- `frc-kiosk-service.service` reports reader/sync health every 15 seconds, and also polls the configured API for remote kiosk commands every `KIOSK_COMMAND_POLL_SECONDS`, default `10`.
- The kiosk UI polls display state from the kiosk service on port `8788` first, then falls back to the local bench API on port `8787`.

Useful commands:

```bash
ssh attkiosk@AttKiosk
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

`student_id` in the bridge line is a retained compatibility storage/protocol name for the existing kiosk SQLite schema. Application JSON and dashboard copy use `memberId`.

For bench testing, enroll or map a finger into slot `1`:

```bash
npm --workspace @frc-attendance/kiosk run fingerprint:map -- \
  --member-id 100001 \
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
Queued scan <uuid> for member 100001
Offline or sync failed; scan remains cached: fetch failed
```

Set `FINGERPRINT_SIMULATE=true` to run without hardware. Repeated matches for the same template slot are suppressed for `FINGERPRINT_DEBOUNCE_SECONDS`, default `8`.

## Roster Sync

The member Google Sheet remains authoritative for active members and stable Member IDs. The API currently accepts normalized roster rows at `POST /admin/roster/sync` with `memberId`, `firstName`, `lastName`, and optional `email`; `studentId` is still accepted as a backwards-compatible input alias. The next implementation step is wiring this endpoint to a Google Sheets reader or an Apps Script push.

The API and dashboard expose member-facing roster/report fields as `memberId`. Existing D1 and kiosk SQLite tables/columns named `students` and `student_id` remain compatibility storage names and should not be migrated casually.

Removed roster entries are deactivated in D1 rather than deleted.

The production Worker also exposes active roster rows to authenticated kiosks at `GET /kiosk/roster`. This uses the kiosk bearer token, so the Pi can refresh its local bench SQLite roster without mentor D1 edits or copying data out of Cloudflare manually.

The Pi-local bench API exposes `POST /admin/roster/pull-production`. The local dashboard shows this as `Pull production roster` and replaces the local active roster with the Worker roster while preserving old rows as inactive. Configure the bench API with:

```ini
Environment=REMOTE_API_BASE_URL=https://frc-attendance-api.frc-attendance.workers.dev
Environment=REMOTE_KIOSK_ID=bench-01
Environment=REMOTE_KIOSK_TOKEN=<raw-kiosk-token>
```

Keep `REMOTE_KIOSK_TOKEN` in a Pi-local systemd drop-in, not in source control. The committed bench API service only sets the production URL and kiosk ID.

Run the Pi-local roster pull smoke check from the workstation after roster-pull changes or Pi bench API redeploys:

```powershell
npm.cmd --workspace @frc-attendance/api run smoke:pi-roster-pull
```

The check SSHes to `attkiosk@AttKiosk`, reads the bench API service environment on the Pi, calls the production Worker roster export with the Pi-local kiosk token, triggers `POST /admin/roster/pull-production`, and verifies the Pi-local active roster exactly matches production. Override the SSH target with `PI_ROSTER_PULL_SSH_TARGET` only when validating a different Pi.
