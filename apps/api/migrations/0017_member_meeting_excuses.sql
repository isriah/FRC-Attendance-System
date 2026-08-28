CREATE TABLE attendance_excuses (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(student_id),
  meeting_date TEXT NOT NULL,
  reason TEXT,
  created_by_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_by_email TEXT,
  removed_at TEXT
);

CREATE INDEX attendance_excuses_meeting_date_idx ON attendance_excuses(meeting_date);
CREATE UNIQUE INDEX attendance_excuses_active_member_date_unique_idx
ON attendance_excuses(student_id, meeting_date)
WHERE removed_at IS NULL;
