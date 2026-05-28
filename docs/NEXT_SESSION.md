# Next Session Handoff

## Current Bench Setup

- Repo: `https://github.com/isriah/FRC-Attendance-System`
- Local workspace: `C:\Users\Izz\Desktop\FRC Attendance System`
- Pi SSH: `attkiosk@192.168.0.154`
- Pi repo path: `~/FRC-Attendance-System`
- Kiosk UI: `http://192.168.0.154:5173`
- Admin dashboard: `http://192.168.0.154:5174`
- Bench API: `http://192.168.0.154:8787`
- Fingerprint reader: R503-style UART reader on `/dev/serial0` at `57600`
- Display: Waveshare 7inch DSI LCD (E), Pi 4B

Active Pi user services:

```bash
frc-bench-api
frc-kiosk-service
frc-kiosk-ui
frc-dashboard-ui
```

Useful Pi commands:

```bash
cd ~/FRC-Attendance-System
git pull
bash apps/kiosk/scripts/install-user-services.sh
systemctl --user restart frc-bench-api frc-kiosk-service frc-kiosk-ui frc-dashboard-ui
systemctl --user status frc-bench-api frc-kiosk-service frc-kiosk-ui frc-dashboard-ui
```

## Current Feature State

- Admin dashboard has roster CSV sync using:

```csv
memberId,firstName,lastName
```

- Roster `memberId` is stored internally as `students.student_id`.
- Fingerprint enrollment is available from the dashboard roster tab.
- Fingerprint templates remain local on the sensor. The kiosk SQLite DB stores slot-to-member mappings.
- Kiosk screen acknowledges scans:
  - known accepted scans show welcome/goodbye plus member name
  - duplicates show already recorded
  - unknown fingerprints show not recognized
  - rejected/inactive members show rejected
- Kiosk acknowledgement can include attendance summary, such as `Attendance 100% (2/2)`.
- Dashboard Reports tab includes:
  - daily presence report
  - per-member attendance report
- Current reporting caveat: missed meetings are calculated from dates where at least one attendance session exists. A real meeting calendar is needed to count scheduled meetings where nobody scans.

## Styling Constraint

Keep new UI styling within the lightweight two-color system:

- primary color
- accent color
- all other state colors derived automatically

Kiosk service env vars:

```ini
Environment="VITE_KIOSK_PRIMARY_COLOR=#B80100"
Environment="VITE_KIOSK_ACCENT_COLOR=#EEB822"
```

Avoid hard-coded one-off colors in new UI. Prefer existing CSS variables and state classes.

## Current Known Members / Bench Data

Known active roster entries from recent bench testing:

- `0267` - Isriah Keila
- `100001` - Bench Student

Known fingerprint mappings:

- slot `1` was originally mapped to `100001`
- slot `2` was enrolled/mapped to `0267`

Verify from Pi if needed:

```bash
sqlite3 ~/FRC-Attendance-System/apps/kiosk/kiosk-cache.sqlite \
  "select student_id, template_slot, finger_label, enrolled_at, deleted_at from local_enrollments;"
```

## Completed Recently

- Added dashboard service on port `5174`.
- Added bench API CORS support.
- Added dashboard roster import.
- Added dashboard fingerprint enrollment.
- Added dashboard kiosk display reload.
- Added kiosk scan acknowledgement display.
- Added basic two-color styling support.
- Fixed runtime theme variables so configured Pi service colors apply at root.
- Added daily presence and member attendance reports.
- Added attendance summary into kiosk acknowledgement payloads.

## Recommended Next Work

1. Cloud backend / online database
   - Create Cloudflare D1 database.
   - Apply migrations remotely.
   - Deploy `apps/api` as a Cloudflare Worker.
   - Point kiosk/dashboard to deployed API.
   - Preserve offline queue behavior.
   - Decide roster sync source: CSV upload, Google Sheet pull, or Apps Script push.

2. Real admin auth
   - Configure Google OAuth client.
   - Add allowlist or Google Workspace group/domain check.
   - Remove or hide local email-only login for production.

3. Reporting improvements
   - Add meeting calendar/source of truth.
   - Count scheduled meetings where nobody scanned.
   - Show absent dates from the meeting calendar.
   - Add CSV/Google Sheets export for report outputs.
   - Add filters for date range and active/inactive members.

4. Fingerprint/admin polish
   - Show current fingerprint slot mappings in dashboard.
   - Auto-suggest next available slot.
   - Add delete/remap enrollment action.
   - Add confirmation before overwriting an occupied slot.

5. Kiosk messaging improvements
   - Add richer user-specific messages returned by API.
   - Make attendance summary configurable on/off.
   - Improve offline acknowledgement: show cached scan clearly when API is unavailable.

6. Multi-kiosk readiness
   - Kiosk provisioning flow with real token generation.
   - Per-kiosk status and sync health in dashboard.
   - Per-kiosk enrollment visibility.
   - Multi-kiosk delayed sync tests.

7. Tests
   - Unit tests for report builders.
   - Unit tests for scan acknowledgement/action derivation.
   - Integration test for offline queue restart/reconnect.
   - Integration test for delayed multi-kiosk sync ordering.

## Verification Commands

Local:

```bash
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
```

Pi health:

```bash
curl -fsS http://localhost:8787/health
curl -fsS http://localhost:8787/admin/students
curl -fsS http://localhost:8787/admin/reports/presence
curl -I http://localhost:5173
curl -I http://localhost:5174
```

Relevant recent commits:

- `5efca09` - Add attendance reporting views
- `d6519f3` - Show attendance rate on kiosk acknowledgement
- `9c41aa7` - Apply kiosk theme colors at root
