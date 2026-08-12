CREATE TABLE notification_deliveries (
  id TEXT PRIMARY KEY,
  notification_kind TEXT NOT NULL,
  meeting_date TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(student_id),
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  error_message TEXT,
  sent_at TEXT,
  error_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX notification_deliveries_lookup_idx
ON notification_deliveries(notification_kind, meeting_date, student_id, recipient_email, status);

