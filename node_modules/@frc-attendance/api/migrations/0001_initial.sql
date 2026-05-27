CREATE TABLE students (
  student_id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  roster_hash TEXT,
  roster_synced_at TEXT NOT NULL
);

CREATE TABLE admin_users (
  email TEXT PRIMARY KEY,
  role TEXT NOT NULL DEFAULT 'mentor',
  active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT
);

CREATE TABLE kiosks (
  kiosk_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  token_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE fingerprint_enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL REFERENCES students(student_id),
  kiosk_id TEXT NOT NULL REFERENCES kiosks(kiosk_id),
  template_slot INTEGER NOT NULL,
  finger_label TEXT,
  enrolled_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(kiosk_id, template_slot)
);

CREATE TABLE scan_events (
  id TEXT PRIMARY KEY,
  kiosk_id TEXT NOT NULL REFERENCES kiosks(kiosk_id),
  local_event_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  synced_at TEXT NOT NULL,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  rejection_reason TEXT,
  UNIQUE(kiosk_id, local_event_id)
);

CREATE INDEX scan_events_student_time_idx ON scan_events(student_id, occurred_at);
CREATE INDEX scan_events_status_idx ON scan_events(status);

CREATE TABLE manual_events (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(student_id),
  occurred_at TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE attendance_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  check_in_at TEXT NOT NULL,
  check_out_at TEXT,
  status TEXT NOT NULL,
  source_event_ids TEXT NOT NULL,
  rebuilt_at TEXT NOT NULL
);

CREATE INDEX attendance_sessions_student_date_idx ON attendance_sessions(student_id, meeting_date);

CREATE TABLE sync_log (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
