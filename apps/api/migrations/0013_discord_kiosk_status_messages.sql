CREATE TABLE discord_kiosk_status_messages (
  channel_id TEXT PRIMARY KEY,
  message_id TEXT,
  status_snapshot_json TEXT NOT NULL DEFAULT '{}',
  rendered_hash TEXT,
  operation_status TEXT NOT NULL DEFAULT 'idle',
  attempts INTEGER NOT NULL DEFAULT 0,
  locked_at TEXT,
  last_attempt_at TEXT,
  last_success_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX discord_kiosk_status_messages_retry_idx
ON discord_kiosk_status_messages(operation_status, updated_at);
