CREATE TABLE kiosk_commands (
  id TEXT PRIMARY KEY,
  kiosk_id TEXT NOT NULL REFERENCES kiosks(kiosk_id),
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  requested_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  message TEXT
);

CREATE INDEX kiosk_commands_kiosk_status_idx ON kiosk_commands(kiosk_id, status, requested_at);
