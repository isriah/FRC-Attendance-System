CREATE TABLE attendance_contests (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(student_id),
  scheduled_meeting_id TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  interaction_id TEXT NOT NULL UNIQUE,
  source_message_id TEXT,
  source_channel_id TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'acknowledged', 'resolved', 'rejected')),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by_admin_email TEXT,
  review_note TEXT
);

CREATE INDEX attendance_contests_status_created_idx
ON attendance_contests(status, created_at);

CREATE INDEX attendance_contests_student_date_idx
ON attendance_contests(student_id, meeting_date);
