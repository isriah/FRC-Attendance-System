CREATE TABLE attendance_exclusions_v2 (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(student_id),
  meeting_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  admin_email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  superseded_by_admin_email TEXT,
  superseded_reason TEXT
);

INSERT INTO attendance_exclusions_v2 (
  id,
  student_id,
  meeting_date,
  reason,
  admin_email,
  created_at
)
SELECT
  id,
  student_id,
  meeting_date,
  reason,
  admin_email,
  created_at
FROM attendance_exclusions;

DROP TABLE attendance_exclusions;
ALTER TABLE attendance_exclusions_v2 RENAME TO attendance_exclusions;

CREATE INDEX attendance_exclusions_meeting_date_idx
ON attendance_exclusions(meeting_date);

CREATE UNIQUE INDEX attendance_exclusions_active_member_date_unique_idx
ON attendance_exclusions(student_id, meeting_date)
WHERE superseded_at IS NULL;
