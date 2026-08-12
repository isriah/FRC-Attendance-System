# FRC Attendance System Agent Guide

## Project Purpose

This repository is a fingerprint-based multi-kiosk attendance system for FRC teams. It supports Raspberry Pi kiosks, local/offline scan capture, roster management, reporting, and a Cloudflare-backed API path.

## Workspace Map

- `apps/api`: Cloudflare Worker API, D1 migrations, roster sync, attendance reports, auth helpers, and the lightweight bench API.
- `apps/kiosk`: Raspberry Pi kiosk UI, fingerprint bridge, offline queue, kiosk service, enrollment/mapping tools, and systemd/browser service assets.
- `apps/dashboard`: React/Vite admin dashboard for roster sync, fingerprint enrollment, reporting, and kiosk controls.
- `packages/shared`: shared attendance logic, types, and validation used across apps.
- `docs`: operational references. Use `docs/OPERATIONS.md` for Cloudflare, deployment, local bench API, dashboard config, kiosk provisioning, fingerprint integration, and roster sync operations. Use `docs/PI-SETUP.md` for Raspberry Pi setup, display/UART wiring, user services, browser autostart, and hardware-specific steps.

## Token-Efficient Session Workflow

Avoid requiring large copy/paste handoffs at the start of new Codex sessions. Stable project facts belong in this file and in `docs`, not in chat. Future sessions should be able to start from a short prompt plus local inspection.

Recommended user kickoff:

```text
Continue in C:\Users\Izz\Desktop\FRC Attendance System.
Read AGENTS.md. Read docs/OPERATIONS.md only if the task touches Cloudflare/API/deploy/roster sync. Read docs/PI-SETUP.md only if the task touches Pi services/display/UART/fingerprint hardware.
Task: <one concrete outcome>.
Latest known commit: <optional hash>.
Known unrelated dirty files: <optional short list>.
Verify, commit, push, and update the Pi only if relevant.
```

At session start, agents should:

- Read `AGENTS.md` first.
- Check `git status --short --branch` and `git log --oneline -5` instead of asking the user to paste repository state.
- Read only the docs relevant to the requested task:
  - `docs/OPERATIONS.md` for Cloudflare, API deployment, dashboard deployment, bench API, auth, roster sync, or kiosk provisioning.
  - `docs/PI-SETUP.md` for Raspberry Pi services, display/browser autostart, UART, fingerprint hardware, or service restarts.
- Prefer inspecting files, commit history, and deployed/local state directly over carrying forward a long chat transcript.
- Keep each session focused on one discrete unit of work. If the next task is unrelated, start a fresh session with the short kickoff above.
- When a director session is coordinating delegated child sessions, it should automatically review, merge, verify, push, deploy, update the Pi, smoke-test, document, and archive completed child work unless a real blocker appears: failed verification, destructive production data mutation, secrets/config uncertainty, or an unresolved product decision.
- Do not paste full docs, AGENTS content, command logs, or broad project history into chat unless specifically needed. Put durable handoff notes in a small repo file instead.

If richer continuity is needed, create or update a short handoff file such as `docs/CODEX-HANDOFF.md` with only:

- latest pushed commit
- current local/Pi dirty files that must be preserved
- last verification/deployment status
- one recommended next task
- any temporary credentials/config caveats, without secrets

Agents should treat that handoff as a pointer for discovery, not as a substitute for checking the real current repo, deployment, and Pi state.

## Common Commands

Run commands from the repo root unless a workspace is specified.

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Development servers:

```powershell
npm run dev:api
npm run dev:kiosk
npm run dev:dashboard
```

For targeted workspace work, prefer:

```powershell
npm --workspace <package> run <script>
```

## Current Product State

- Cloudflare Worker API is deployed at `https://frc-attendance-api.frc-attendance.workers.dev`.
- Production D1 database `frc-attendance` exists in Cloudflare with database ID `c02c0ca8-033b-435f-ae21-2d8f3b203b22`, and initial migrations have been applied remotely.
- API remote migration and deploy scripts run a production preflight that blocks placeholder D1 IDs and empty Google admin auth config.
- API admin auth is configured for Google OAuth client `180849199739-v04bktp7rfmimgjpvohmq7pinrrpr337.apps.googleusercontent.com` with `isriahk@gmail.com` allowlisted.
- Roster CSV sync currently expects `memberId,firstName,lastName`.
- Roster `memberId` is stored internally as `students.student_id`.
- Dashboard roster management defaults to active members, with separate tabs for deactivated member management and roster import. Deactivate/reactivate preserves attendance history; hard delete requires typed confirmation and removes associated member-owned attendance/event/fingerprint mapping rows without removing dashboard admin users. The default roster table stays compact; member email editing, attendance details, and per-member fingerprint enrollment live in the row details flow.
- Fingerprint enrollment is available from active member row details in the Pi-local dashboard, using fixed finger-label options instead of free-text labels.
- Fingerprint templates remain local on the sensor. The kiosk SQLite DB stores slot-to-member mappings.
- Kiosk scan acknowledgements cover known accepted scans, duplicates, unknown fingerprints, rejected/inactive members, and optional attendance summaries.
- Dashboard kiosk controls can queue per-kiosk remote commands for active kiosks: restart display, restart kiosk services, or reboot system. Kiosk services poll the API for these commands with their kiosk token and execute only allowlisted local actions.
- Remote kiosk reboot requires the Pi sudoers rule installed by `sudo bash apps/kiosk/scripts/install-reboot-sudoers.sh`, which permits only `/usr/bin/systemctl reboot` without an interactive password.
- Dashboard reports include scheduled-meeting summaries, zero-scan required meetings, per-meeting absence drilldowns, daily presence, per-member attendance, roster-wide attendance summaries, and mentor-facing export ranges. Future/in-progress scheduled meetings and unscheduled attendance-only dates are excluded from default attendance counts/report rows until explicitly shown.
- Dashboard meeting/report views can show unscheduled attendance on demand, convert an attendance-only date into a scheduled meeting, or clear attendance source data for a date with typed confirmation.
- Dashboard roster page shows each active member's attendance percentage from completed required scheduled meetings; optional and future/in-progress meetings do not count against members.
- The API has a missed-meeting notification foundation for member emails: `POST /admin/notifications/meeting-absence` previews or sends absence emails for completed required scheduled meetings, tracks delivery audit rows in D1, skips duplicate successful sends by default, and sends through Resend when configured. Production has `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS=attendance@robolancers.com`, and `EMAIL_FROM_NAME=FRC Attendance` configured as Worker secrets.
- Dashboard is deployed to Cloudflare Pages project `frc-attendance-dashboard` at `https://frc-attendance-dashboard.pages.dev`.
- The deployed dashboard build is configured with `VITE_API_BASE_URL=https://frc-attendance-api.frc-attendance.workers.dev` and Google OAuth client `180849199739-v04bktp7rfmimgjpvohmq7pinrrpr337.apps.googleusercontent.com`.
- Automated dashboard smoke checks on 2026-05-28 confirmed the Pages URL serves, Google sign-in renders, API CORS allows dashboard requests, unauthenticated admin API calls are rejected with `401 Missing admin identity`, and credentialed admin pages load after Google sign-in. Interactive Google sign-in works after adding `https://frc-attendance-dashboard.pages.dev` to the Google OAuth client's Authorized JavaScript origins. Dashboard deployment `https://9c9f9dd1.frc-attendance-dashboard.pages.dev` prevents the production app from using a stale email-only local session when Google OAuth is configured. Dashboard deployment `https://c1a584ae.frc-attendance-dashboard.pages.dev` includes per-kiosk remote restart command buttons. Dashboard deployment `https://933d1d20.frc-attendance-dashboard.pages.dev` shows recent queued/running/completed/failed kiosk command status per kiosk.
- Dashboard source now renders the local email-only login only when `VITE_GOOGLE_CLIENT_ID` is unset. When Google auth is configured, the login screen presents Google sign-in and clearly states that email-only local login is disabled.
- The bench Raspberry Pi kiosk `bench-01` is registered in remote D1 and the installed user service on `AttKiosk` points at `https://frc-attendance-api.frc-attendance.workers.dev` via a systemd user drop-in. Offline queue replay against remote D1 was verified on 2026-05-28 with local event `remote-replay-1de1a877-fa2c-482f-b388-335758e663de`, which synced as an accepted scan for member `100001`.
- SSH to the bench Pi must use the kiosk account explicitly: `ssh attkiosk@AttKiosk`. Do not use plain `ssh AttKiosk`, because that defaults to the local workstation username and fails when the local user is not `attkiosk`.
- Current feature-completion priority is kiosk/member-facing polish and focused reliability tests until real roster and meeting data are available for reporting validation. Multi-kiosk functionality is backburnered for now.

## Development Guardrails

- Keep changes scoped to the relevant app/package.
- Prefer existing workspace scripts, shared package types, and shared utilities over duplicated contracts.
- Read `docs/OPERATIONS.md` before Cloudflare, auth, roster sync, deployment, local bench API, environment, or kiosk provisioning changes.
- Read `docs/PI-SETUP.md` before Raspberry Pi, service, display, UART, browser autostart, or fingerprint hardware changes.
- Preserve offline queue behavior when changing API sync, cloud backend, kiosk service, or network error handling.
- Preserve the fingerprint architecture: application code should work with match results, local template slots, and member mappings. Do not add backend storage for raw fingerprint scans or fingerprint templates.
- Keep kiosk and dashboard styling within the lightweight primary/accent color system. Prefer existing CSS variables and state classes over hard-coded one-off colors.
- Do not hard-code production secrets, OAuth values, kiosk tokens, or environment-specific deployment config in source.
- Do not overwrite local roster data, fingerprint mappings, or SQLite cache files unless the user explicitly asks.

## Future Work Priorities

- Validate the deployed mentor-ready scheduled-meeting reporting workflows:
  1. Review scheduled meeting summaries, absence drilldowns, roster attendance, and export ranges with real roster data.
  2. Polish report/export formatting or Google Sheets integration based on mentor feedback.
- Polish fingerprint administration by showing current slot mappings, auto-suggesting the next available slot, supporting delete/remap, and confirming before overwriting occupied slots.
- Improve kiosk messaging with richer API-provided member messages, configurable attendance summary display, and clearer offline acknowledgements.
- Backburnered: prepare for multi-kiosk operation with real kiosk token provisioning, per-kiosk status/sync health, enrollment visibility, and delayed sync tests.
- Backburnered: email notifications for upcoming meetings, meeting changes, or attendance digests. Initial missed-meeting email support targets Resend for delivery; member emails still do not grant dashboard admin access.
- Focused report builder, scan acknowledgement/action derivation, and offline queue restart/reconnect tests are in place. Delayed multi-kiosk sync ordering is backburnered with multi-kiosk work.

## Verification Expectations

- For documentation-only changes, runtime tests are not required.
- For code changes, run targeted tests and typechecks for the changed workspace first.
- Run root `npm.cmd run typecheck` when TypeScript contracts or shared code change.
- Run root `npm.cmd run build` when frontend, package, deployment, or build behavior changes.
- When Raspberry Pi validation is needed, SSH directly into the Pi as `attkiosk@AttKiosk` and run the checks there instead of asking the user to run commands manually.
- When a verified change affects Raspberry Pi kiosk behavior, SSH into the affected Pi as `attkiosk@AttKiosk`, pull the new code, and restart any user services needed for the change to appear, such as `frc-kiosk-ui`, `frc-kiosk-service`, `frc-bench-api`, or `frc-dashboard-ui`.
- Keep commits focused. Agents should create a Git commit after each completed, verified discrete unit unless the user explicitly asks not to commit.
- Before committing, inspect `git status --short`, stage only files related to the completed unit, and do not stage unrelated user changes.
- Use concise commit messages that describe the shipped behavior, not the process. Push completed, tested, and verified code at the end of sessions unless the user explicitly asks not to push.

## End-of-Session Handoff

At the end of each completed session, include a compact next-session handoff so the user does not need to decide or reconstruct context.

Final responses should include:

- the latest pushed commit hash
- whether the local repo is clean
- any known unrelated dirty files that must be preserved
- one recommended next task, chosen from the highest-value remaining work
- a ready-to-paste kickoff prompt for the next Codex session

Keep this handoff short. Do not repeat long logs, full verification output, or broad project history.
