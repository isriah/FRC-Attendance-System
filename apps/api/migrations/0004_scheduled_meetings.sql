CREATE TABLE scheduled_meetings (
  id TEXT PRIMARY KEY,
  meeting_date TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT,
  ends_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX scheduled_meetings_required_date_idx ON scheduled_meetings(required, meeting_date);
