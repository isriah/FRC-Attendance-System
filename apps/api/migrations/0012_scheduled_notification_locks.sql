CREATE TABLE scheduled_notification_locks (
  id TEXT PRIMARY KEY,
  notification_kind TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  locked_at TEXT,
  completed_at TEXT,
  last_attempt_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(notification_kind, meeting_date)
);

CREATE INDEX scheduled_notification_locks_lookup_idx
ON scheduled_notification_locks(notification_kind, status, meeting_date);
