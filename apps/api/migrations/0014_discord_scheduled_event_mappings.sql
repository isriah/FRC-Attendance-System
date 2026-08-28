CREATE TABLE discord_scheduled_event_mappings (
  scheduled_meeting_id TEXT PRIMARY KEY REFERENCES scheduled_meetings(id) ON DELETE CASCADE,
  guild_id TEXT NOT NULL,
  discord_event_id TEXT NOT NULL,
  location TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'synced',
  attempts INTEGER NOT NULL DEFAULT 1,
  last_synced_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX discord_scheduled_event_mappings_event_idx
ON discord_scheduled_event_mappings(guild_id, discord_event_id);
