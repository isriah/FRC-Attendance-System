# Operations Guide

## Cloudflare Setup

Current production API:

- Worker URL: `https://frc-attendance-api.frc-attendance.workers.dev`
- Latest deployed Worker version: `abfe2271-ebc5-4014-a007-3d07cf6eb994`
- D1 database: `frc-attendance`
- D1 database ID: `c02c0ca8-033b-435f-ae21-2d8f3b203b22`
- Applied remote migrations: `0001_initial.sql` through `0007_student_discord_user_id.sql`
- Workers account subdomain: `frc-attendance.workers.dev`
- Registered bench kiosk: `bench-01`

Current production dashboard:

- Cloudflare Pages project: `frc-attendance-dashboard`
- Pages URL: `https://frc-attendance-dashboard.pages.dev`
- Latest verified deployment: `https://05020763.frc-attendance-dashboard.pages.dev`
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
   - `RESEND_API_KEY`: Resend API key for missed-meeting notifications; store as a Worker secret when used.
   - `EMAIL_FROM_ADDRESS`: verified Resend sender address; required with `RESEND_API_KEY` to enable actual sends.
   - `EMAIL_FROM_NAME`: optional display name, defaults to `FRC Attendance`.
   - `EMAIL_PROVIDER_URL` and `EMAIL_PROVIDER_API_KEY`: optional legacy generic HTTP provider settings retained for local experiments; prefer Resend for production.
   - `DISCORD_MISSING_MEMBERS_WEBHOOK_URL`: optional Discord channel webhook URL for missing-member pings. Store as a Worker secret. `DISCORD_WEBHOOK_URL` is accepted as a generic fallback, but the missing-members-specific name is preferred.

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

Deployment `https://7ac9ef54.frc-attendance-dashboard.pages.dev` renames product-facing roster people from students to members across dashboard labels, API response contracts, kiosk sync payloads, reports, exports, scripts, and docs. Worker version `51c04831-30ac-4101-a693-c67bacbf693b` adds `/admin/members` while retaining `/admin/students`, `studentId`, `--student-id`, and physical `students.student_id` storage compatibility names. No new D1 migration was required. Production Worker/dashboard smoke passed on 2026-08-10 with Pi skipped.

Deployment `https://50ac4035.frc-attendance-dashboard.pages.dev` adds bulk meeting administration from the Meetings All Meetings tab: selectable meeting rows, bulk delete with confirmation, and bulk edit for title, required/optional status, start/end times, and notes. Worker version `66df18f9-1a01-4e70-a7f8-4d135bf94a46` exposes `POST /admin/meetings/bulk-delete` and keeps single-meeting update behavior for bulk edits. No new D1 migration was required. Production Worker/dashboard smoke passed on 2026-08-11 with Pi skipped because the bench hostname was not resolvable from the workstation.

Deployment `https://9ce3910c.frc-attendance-dashboard.pages.dev` polishes Meetings UI layout: the All Meetings bulk-edit checkbox rows align with their corresponding fields, the active Add/Edit Meeting tab stays visible but no longer resets the form when clicked again, and meeting start/end time fields share a row when responsive space allows. No Worker change or D1 migration was required. Production Worker/dashboard smoke passed on 2026-08-11 with Pi skipped.

Bench Pi update on 2026-08-11 pulled main through commit `319f96f398c1bd8535e8036ce9205b7b76ab2992` and restarted `frc-dashboard-ui`, `frc-bench-api`, and `frc-kiosk-service`. The Pi-local dashboard serves at `http://192.168.0.154:5174` from the workstation and `http://localhost:5174` on the Pi; direct `http://AttKiosk:5174` returned 403 from Vite host checking. The served dashboard source includes the fingerprint mapping `Remap` action, bench API health returned ok, and `frc-kiosk-service` reported `Fingerprint reader online`.

Worker version `312ce5fb-729e-4124-9b33-411a56e0e9af` adds clearer member-facing kiosk acknowledgement copy for accepted, duplicate, rejected/inactive, unknown fingerprint, and offline-saved scans, plus `KIOSK_SHOW_ATTENDANCE_SUMMARY` to control whether attendance summary text appears in kiosk acknowledgement detail. Bench Pi update on 2026-08-11 pulled main through commit `97a0a1985b9577d29c81a82a3a0f2dd0466a5b80` and restarted `frc-bench-api`, `frc-kiosk-service`, and `frc-kiosk-ui`. Production Worker/dashboard smoke and Pi-local roster pull smoke passed; bench API health returned ok, kiosk UI served at `http://192.168.0.154:5173`, and `frc-kiosk-service` reported `Fingerprint reader online`.

Deployment `https://3cd95a98.frc-attendance-dashboard.pages.dev` adds roster-page attendance percentages per active member, using the existing roster attendance summary report so required scheduled meetings drive the percentage and optional meetings do not count against members. Production Worker/dashboard smoke and Pi-local roster pull smoke passed on 2026-08-12. Bench Pi update on 2026-08-12 pulled main through commit `ae727a92e4e8a143adff6b3e9ee10e608f48b1d1` and restarted `frc-dashboard-ui` and `frc-bench-api`; the Pi-local dashboard served at `http://192.168.0.154:5174` and included the roster attendance UI.

Deployment `https://7c2b740e.frc-attendance-dashboard.pages.dev` adds member lifecycle management on the Roster page: Active Members, Deactivated Members, and Roster Import tabs; deactivate/reactivate actions that preserve history; and hard delete with typed `DELETE <Member ID>` confirmation for removing member-owned roster, attendance, event, and fingerprint mapping records while preserving dashboard admin users. Worker version `0262c023-b7c5-4dfc-8791-d4f3e67f9807` exposes the matching authenticated member lifecycle endpoints. No new D1 migration was required. Production Worker/dashboard smoke and Pi-local roster pull smoke passed on 2026-08-12. Bench Pi update on 2026-08-12 pulled main through commit `c6d409ec7bbd6b6e698d6f7919803a66c8f80c58` and restarted `frc-dashboard-ui` and `frc-bench-api`.

Deployment `https://c0720753.frc-attendance-dashboard.pages.dev` polishes roster administration: removes the member lifecycle notice from the Roster page, keeps default roster rows compact, moves email editing and attendance drilldown into per-member details, removes the default Required Meetings counter, and moves fingerprint enrollment into active member details with a fixed ten-finger label selector. No Worker change or D1 migration was required. Production Worker/dashboard smoke and Pi-local roster pull smoke passed on 2026-08-12. Bench Pi update on 2026-08-12 pulled main through commit `cafa3dffae3eb933402766e15e4214ab3970ed08` and restarted `frc-dashboard-ui` and `frc-bench-api`.

Worker version `d276724a-511c-43cc-a5c9-443164ec62f5` excludes future and in-progress scheduled meetings from attendance/report counts by default, including roster attendance percentages, per-member missed meeting details, meeting summaries, and attendance session report rows. Timed scheduled meetings count after their `ends_at`; date-only meetings use the existing local report date rule. Meeting administration/calendar views still show and manage future meetings. No D1 migration was required. Production Worker/dashboard smoke and Pi-local roster pull smoke passed on 2026-08-12. Bench Pi update on 2026-08-12 pulled main through commit `3be6b15a709e75c8959b166a2af7d16255439036` and restarted `frc-bench-api` and `frc-dashboard-ui`.

Deployment `https://0c2ffd86.frc-attendance-dashboard.pages.dev` and Worker version `10baf524-a915-4b12-afce-4bfa3c2d4367` add unscheduled attendance management. Reports hide attendance-only dates by default and expose `includeUnscheduled=1`; dashboard Meetings and Reports views provide a Show unscheduled attendance toggle, Convert action to create a scheduled meeting for an attendance-only date, and destructive Clear action guarded by typed `CLEAR YYYY-MM-DD` confirmation. Clear removes API-owned scan/manual source events for that local date, rebuilds derived sessions, and preserves scheduled meetings, roster, admins, kiosks, and fingerprint mappings. No D1 migration was required. Production Worker/dashboard smoke and Pi-local roster pull smoke passed on 2026-08-12. Bench Pi update on 2026-08-12 pulled main through commit `ea991045183b7790cc18b2f46484e9e6316b5fbd` and restarted `frc-bench-api` and `frc-dashboard-ui`.

Deployment `https://4810fab3.frc-attendance-dashboard.pages.dev` and Worker version `cb053a95-5869-4e62-b0e5-042382958721` add missed-meeting absence email previews/sends for completed required scheduled meetings, roster search by member ID/name, and web-dashboard hiding of unavailable fingerprint detail controls. Remote D1 migration `0006_notification_deliveries.sql` was applied. Email sending remains preview-only until `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` are configured. Production Worker/dashboard smoke and Pi-local roster pull smoke passed on 2026-08-12. Bench Pi update on 2026-08-12 pulled main through commit `d30e35e65bab1d7a7c23abf1b4fe4be13c57ef06` and restarted `frc-dashboard-ui` and `frc-bench-api`.

Worker version `0a86a165-d6b9-4c90-a66e-80e35e3a44d2` deploys first-class Resend delivery for missed-meeting emails from merged `main`. Worker secrets `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, and `EMAIL_FROM_NAME` are configured remotely; `EMAIL_FROM_ADDRESS` is `attendance@robolancers.com` and `EMAIL_FROM_NAME` is `FRC Attendance`. Worker health passed on 2026-08-12, and the notification endpoint returned `401` without admin auth. Terminal preview smoke was not run because production admin routes require a Google ID token when `GOOGLE_CLIENT_ID` is configured.

Deployment `https://4bbc28eb.frc-attendance-dashboard.pages.dev` and Worker version `33c96de6-761d-4fe5-8568-1335ecd2a2de` add the Roster member-detail action to preview and send a member's current attendance report by email. Member report emails use Resend delivery, `notification_kind = 'member_attendance_report'`, and same-day duplicate protection by default. Production Worker/dashboard smoke and Pi-local roster pull smoke passed on 2026-08-12; the new member report endpoint returned `401` without admin auth.

Deployment `https://2ded3f58.frc-attendance-dashboard.pages.dev` fixes Meetings calendar event subtext so missing completed-report rows no longer display as permanent `Loading...`. Calendar cards now show loading only while report data is pending, then show present/absent counts, `Upcoming`, `No attendance yet`, `0 present`, or `Report unavailable` as appropriate. Dashboard smoke passed against the immutable deployment URL on 2026-08-12; canonical Pages smoke initially saw stale bundle config immediately after deploy.

Deployment `https://85462f9f.frc-attendance-dashboard.pages.dev` and Worker version `4ba522eb-fff5-4af4-81e3-bd57df941df9` add initial Discord missing-member notification support. Remote D1 migration `0007_student_discord_user_id.sql` was applied. The dashboard can store member Discord user IDs and preview/confirm pings for absent members on completed required meetings. Production API/dashboard smoke passed on 2026-08-14 with Pi skipped because the bench Pi was unreachable by hostname and last known IP.

Worker version `e72a04d8-be30-45e2-b4b6-c71970b22fc5` configures production `DISCORD_MISSING_MEMBERS_WEBHOOK_URL` as a Worker secret, enabling Discord missing-member sends after dashboard preview/confirmation. The secret name was confirmed with `wrangler secret list`; production API/dashboard smoke passed on 2026-08-14 with Pi skipped because the bench Pi hostname did not resolve. The Discord endpoint returned `401 Missing admin identity` without admin auth. No real Discord message was sent from terminal smoke because no production admin Google ID token/session was available.

Deployment `https://206a28c9.frc-attendance-dashboard.pages.dev` and Worker version `abfe2271-ebc5-4014-a007-3d07cf6eb994` add a safe Discord webhook debug test route and dashboard Overview action. The authenticated admin route is `POST /admin/notifications/discord/test`; it sends a harmless test payload with `allowed_mentions` disabled and does not read or mutate meeting, attendance, member, or notification audit data. Production Worker health, CORS preflight, dashboard serving, and unauthenticated route rejection passed on 2026-08-14. The repeatable Node smoke script failed at Worker health with `fetch failed` from this workstation, matching the known Windows network path issue; equivalent `curl.exe -4` smoke checks passed. Pi smoke was skipped because the task did not change Pi services and the bench Pi was previously unreachable by hostname. No real Discord debug message was sent because no production admin Google ID token/session was available in the terminal smoke context.

Deployment `https://05020763.frc-attendance-dashboard.pages.dev` formats dashboard table timestamp display cells without changing API payloads or export data: Daily Presence and attendance audit `Time In`/`Time Out` columns render local `HH:MM AM/PM`, and Events `Occurred At` renders local date plus time. Production Worker health, Pages serving, baked dashboard config, CORS preflight, unauthenticated route rejection, and authenticated Reports/Events UI smoke passed on 2026-08-26. Authenticated smoke confirmed Reports counts for `2026-08-26` remained 48 present, 13 absent, and 4 open check-ins.

The dashboard login UI follows the same boundary: when `VITE_GOOGLE_CLIENT_ID` is configured, it shows Google sign-in and a production notice that email-only local login is disabled. The email-only form is rendered only for local development builds with no Google client ID.

For local development only, if no Google client ID is configured, the dashboard can send an `x-admin-email` header and the API will still enforce the configured allowlist.

Dashboard admin access is authorized when any of these are true:

- the signed-in email is active in the D1 `admin_users` table
- the signed-in email is listed in `GOOGLE_ALLOWED_EMAILS`
- the signed-in email matches `GOOGLE_ALLOWED_DOMAIN`

The env allowlist/domain are retained as bootstrap access so an existing deployment can create database-backed admins from the dashboard. If an email has an `admin_users` row with `active = 0`, that user is blocked even if an env allowlist or domain would otherwise match. Successful admin requests update `admin_users.last_login_at`; allowlisted/domain users without a row are inserted as active `mentor` users on first successful request.

Dashboard admins can manage database-backed OAuth access from the Admins tab by email, active status, and `mentor`/`admin` role. The role is stored for policy and audit use; current dashboard routes require an authenticated active admin but do not yet restrict actions by role.

Dashboard roster records can store an optional member email for user association. That member email does not grant dashboard admin access by itself; add the email on the Admins tab or keep it covered by the Worker env allowlist/domain.

## Member Email Notifications

The Worker exposes authenticated admin `POST /admin/notifications/meeting-absence` for completed required scheduled meetings. The request body accepts `meetingDate`, optional `preview`, and optional `resend`; the dashboard uses preview first, then confirms before sending when a provider is configured.

The Worker also exposes authenticated admin `POST /admin/notifications/member-attendance-report` for one member's current attendance report. The request body accepts `memberId`, optional `preview`, and optional `resend`; the Roster page member details action previews first, requires confirmation before sending, and is disabled until the member has a saved email address. The report includes member name/ID, current required attendance percentage, completed required meetings attended/missed counts, missed required meeting dates, and optional/not-required meetings when available. Future and in-progress meetings are excluded from required attendance counts, matching the report endpoints. Successful member report sends use `notification_kind = 'member_attendance_report'` and the current local report date as the audit/idempotency date, so accidental same-day double-clicks are skipped by default while `resend: true` intentionally sends another copy.

Production email sending uses Resend. Sending is disabled unless both `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` are configured. The deployed Worker currently has `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS=attendance@robolancers.com`, and `EMAIL_FROM_NAME=FRC Attendance` configured as secrets. In disabled mode, the endpoint returns who would receive email, who is missing a member email, and a warning without writing delivery audit rows. When enabled, the Worker posts to `https://api.resend.com/emails` with `Authorization: Bearer <RESEND_API_KEY>`, a Resend idempotency key, and a JSON body containing `from`, `to`, `subject`, `html`, and `text`. The provider-specific shape is isolated in `apps/api/src/notifications.ts`; legacy `EMAIL_PROVIDER_URL` and `EMAIL_PROVIDER_API_KEY` generic HTTP settings are still accepted for non-production experiments.

Resend setup:

1. Verify a sender domain in Resend and create an API key. For free/no-branding delivery, use an address on the verified team domain rather than a shared or test sender.
2. Configure the Worker secret and sender variables without committing secrets:

   ```powershell
   npx.cmd wrangler secret put RESEND_API_KEY --config apps/api/wrangler.toml
   npx.cmd wrangler secret put EMAIL_FROM_ADDRESS --config apps/api/wrangler.toml
   npx.cmd wrangler secret put EMAIL_FROM_NAME --config apps/api/wrangler.toml
   ```

   Suggested values:

   - `EMAIL_FROM_ADDRESS`: `attendance@<verified-domain>`
   - `EMAIL_FROM_NAME`: `FRC Attendance`

3. Deploy the Worker after secrets are set:

   ```powershell
   npm.cmd --workspace @frc-attendance/api run deploy
   ```

4. Use the dashboard missed-meeting preview first, then send one completed required meeting as a smoke test. Confirm Resend shows accepted deliveries and `notification_deliveries.provider_message_id` is populated.

Migration `0006_notification_deliveries.sql` creates `notification_deliveries` for audit and duplicate prevention. It tracks notification kind, meeting date, member ID, recipient email, status, provider message ID, error message, and sent/error timestamps. Successful prior deliveries are skipped by default; `resend: true` includes them again.

Member notification emails are roster metadata only. They are separate from dashboard admin emails and do not grant API or dashboard access.

## Discord Missing-Member Notifications

The Worker source exposes authenticated admin `POST /admin/notifications/discord/missing-members` for completed required scheduled meetings. The request body accepts `meetingDate`, optional `preview`, and optional `resend`. The dashboard Meetings detail action previews first, reports absent members with saved Discord user IDs, reports absent members missing Discord IDs, and asks for confirmation before sending.

Discord delivery uses one configured channel webhook message per meeting, not a gateway bot. The message mentions only saved Discord user IDs as `<@id>` and sends Discord `allowed_mentions` with `parse: []` plus the explicit `users` list, so `@everyone`, `@here`, and accidental role/user parsing are not enabled. Optional meetings and future/in-progress meetings are rejected using the same completed-required-meeting guard as missed-meeting emails.

For safe webhook delivery checks without a real eligible meeting, the Worker also exposes authenticated admin `POST /admin/notifications/discord/test`. The dashboard Overview tab has a compact `Send Discord test` action for this route. It uses the same configured Discord webhook provider but never reads or mutates meeting, attendance, member, or `notification_deliveries` data. The test message includes non-secret debug metadata such as app name, timestamp, notification kind, and Worker version metadata when available. It sends `allowed_mentions` with `parse: []` and an empty `users` array, and the message body contains no user, role, `@everyone`, or `@here` mentions. When no webhook secret is configured, the route returns preview-only disabled feedback without calling Discord.

Production has `DISCORD_MISSING_MEMBERS_WEBHOOK_URL` configured as a Worker secret. Sending is disabled unless `DISCORD_MISSING_MEMBERS_WEBHOOK_URL` or fallback `DISCORD_WEBHOOK_URL` is configured. In disabled mode, the endpoint returns preview data and warnings without writing delivery audit rows. Successful sends use `notification_kind = 'discord_missing_members'` in `notification_deliveries`; the existing `recipient_email` compatibility column stores the Discord user ID for duplicate detection. Prior successful pings for the same meeting/member are skipped by default; `resend: true` intentionally includes them again.

Discord setup:

1. In Discord, create a private/team-controlled channel webhook for attendance pings and copy the webhook URL.
2. Confirm migration `0007_student_discord_user_id.sql` is applied. Production has this migration applied as of Worker version `4ba522eb-fff5-4af4-81e3-bd57df941df9`.
3. Configure the Worker secret without committing it:

   ```powershell
   npx.cmd wrangler secret put DISCORD_MISSING_MEMBERS_WEBHOOK_URL --config apps/api/wrangler.toml
   ```

4. Deploy the Worker and dashboard.
5. Save Discord user IDs on member details or include an optional `discordUserId` column in roster import. Use numeric Discord user IDs, not display names.
6. Preview one completed required meeting from the dashboard before sending. Confirm the Discord message appears in the intended channel and `notification_deliveries` rows are written with `notification_kind = 'discord_missing_members'`.

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

The member Google Sheet remains authoritative for active members and stable Member IDs. The API currently accepts normalized roster rows at `POST /admin/roster/sync` with `memberId`, `firstName`, `lastName`, optional `email`, and optional `discordUserId`; `studentId` is still accepted as a backwards-compatible input alias. The dashboard CSV import accepts Discord aliases such as `discordUserId`, `discord_user_id`, `discordId`, and `discord`. The next implementation step is wiring this endpoint to a Google Sheets reader or an Apps Script push.

The API and dashboard expose member-facing roster/report fields as `memberId`. Existing D1 and kiosk SQLite tables/columns named `students` and `student_id` remain compatibility storage names and should not be migrated casually.

Removed roster entries are deactivated in D1 rather than deleted. The Roster page's hard-delete action is a separate explicit administration action with typed confirmation, intended only for records that should be permanently removed along with associated member-owned attendance/event/fingerprint mapping data.

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
