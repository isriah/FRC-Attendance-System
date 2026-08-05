# Codex Handoff

## Scheduled Meetings Deployment Prep

- Feature branch: `codex/meeting-calendar-complete-v3`
- Latest pushed feature commit: `466ae5f50d784a0cf2e5ee4c41e048e8d6151ece`
- Current scope: scheduled meetings are implemented across the API, dashboard, shared report logic, local bench API parity, report/export behavior, recurring meeting creation, and bench meeting parity smoke coverage.
- Verification status: completed feature work includes targeted tests/typechecks/build checks and bench/local parity smoke work from the feature branch. Production deployment has not been run.
- Preserve: the bench Pi has an unrelated dirty `package-lock.json`; do not touch the Pi or overwrite that file without explicit approval.

Production deployment checklist:

1. Review and merge `codex/meeting-calendar-complete-v3`.
2. Apply D1 migration `0004` to production.
3. Deploy the Cloudflare Worker.
4. Deploy the dashboard to Cloudflare Pages with production Vite variables.
5. Run `npm.cmd run smoke:predeploy`.
6. Optionally update the bench Pi only after explicit approval.

Recommended next task: review/merge the scheduled meetings feature branch, then perform the production migration and deployment checklist in order.
