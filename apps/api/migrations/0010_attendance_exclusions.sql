CREATE TABLE attendance_exclusions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(student_id),
  meeting_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, meeting_date)
);

CREATE INDEX attendance_exclusions_meeting_date_idx ON attendance_exclusions(meeting_date);
