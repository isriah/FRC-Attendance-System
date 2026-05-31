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
- Fingerprint enrollment is available from the dashboard roster tab.
- Fingerprint templates remain local on the sensor. The kiosk SQLite DB stores slot-to-member mappings.
- Kiosk scan acknowledgements cover known accepted scans, duplicates, unknown fingerprints, rejected/inactive members, and optional attendance summaries.
- Dashboard kiosk controls can queue per-kiosk remote commands for active kiosks: restart display, restart kiosk services, or reboot system. Kiosk services poll the API for these commands with their kiosk token and execute only allowlisted local actions.
- Remote kiosk reboot requires the Pi sudoers rule installed by `sudo bash apps/kiosk/scripts/install-reboot-sudoers.sh`, which permits only `/usr/bin/systemctl reboot` without an interactive password.
- Dashboard reports currently include daily presence and per-member attendance.
- Dashboard is deployed to Cloudflare Pages project `frc-attendance-dashboard` at `https://frc-attendance-dashboard.pages.dev`.
- The deployed dashboard build is configured with `VITE_API_BASE_URL=https://frc-attendance-api.frc-attendance.workers.dev` and Google OAuth client `180849199739-v04bktp7rfmimgjpvohmq7pinrrpr337.apps.googleusercontent.com`.
- Automated dashboard smoke checks on 2026-05-28 confirmed the Pages URL serves, Google sign-in renders, API CORS allows dashboard requests, unauthenticated admin API calls are rejected with `401 Missing admin identity`, and credentialed admin pages load after Google sign-in. Interactive Google sign-in works after adding `https://frc-attendance-dashboard.pages.dev` to the Google OAuth client's Authorized JavaScript origins. Dashboard deployment `https://9c9f9dd1.frc-attendance-dashboard.pages.dev` prevents the production app from using a stale email-only local session when Google OAuth is configured. Dashboard deployment `https://c1a584ae.frc-attendance-dashboard.pages.dev` includes per-kiosk remote restart command buttons. Dashboard deployment `https://933d1d20.frc-attendance-dashboard.pages.dev` shows recent queued/running/completed/failed kiosk command status per kiosk.
- Dashboard source now renders the local email-only login only when `VITE_GOOGLE_CLIENT_ID` is unset. When Google auth is configured, the login screen presents Google sign-in and clearly states that email-only local login is disabled.
- The bench Raspberry Pi kiosk `bench-01` is registered in remote D1 and the installed user service on `AttKiosk` points at `https://frc-attendance-api.frc-attendance.workers.dev` via a systemd user drop-in. Offline queue replay against remote D1 was verified on 2026-05-28 with local event `remote-replay-1de1a877-fa2c-482f-b388-335758e663de`, which synced as an accepted scan for student `100001`.
- Missed-meeting reporting is incomplete until a real meeting calendar or other meeting source of truth exists. Current missed-meeting calculations can only reason from dates where at least one attendance session exists.

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

- Improve reporting around a meeting calendar/source of truth so scheduled meetings with no scans are counted correctly.
- Polish fingerprint administration by showing current slot mappings, auto-suggesting the next available slot, supporting delete/remap, and confirming before overwriting occupied slots.
- Improve kiosk messaging with richer API-provided member messages, configurable attendance summary display, and clearer offline acknowledgements.
- Prepare for multi-kiosk operation with real kiosk token provisioning, per-kiosk status/sync health, enrollment visibility, and delayed sync tests.
- Add tests for report builders, scan acknowledgement/action derivation, offline queue restart/reconnect, and delayed multi-kiosk sync ordering.

## Verification Expectations

- For documentation-only changes, runtime tests are not required.
- For code changes, run targeted tests and typechecks for the changed workspace first.
- Run root `npm.cmd run typecheck` when TypeScript contracts or shared code change.
- Run root `npm.cmd run build` when frontend, package, deployment, or build behavior changes.
- When Raspberry Pi validation is needed, SSH directly into the Pi and run the checks there instead of asking the user to run commands manually.
- When a verified change affects Raspberry Pi kiosk behavior, SSH into the affected Pi, pull the new code, and restart any user services needed for the change to appear, such as `frc-kiosk-ui`, `frc-kiosk-service`, `frc-bench-api`, or `frc-dashboard-ui`.
- Keep commits focused. Agents should create a Git commit after each completed, verified discrete unit unless the user explicitly asks not to commit.
- Before committing, inspect `git status --short`, stage only files related to the completed unit, and do not stage unrelated user changes.
- Use concise commit messages that describe the shipped behavior, not the process. Push completed, tested, and verified code at the end of sessions unless the user explicitly asks not to push.
