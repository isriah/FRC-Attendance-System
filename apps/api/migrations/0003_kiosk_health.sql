ALTER TABLE kiosks ADD COLUMN last_heartbeat_at TEXT;
ALTER TABLE kiosks ADD COLUMN reader_online INTEGER;
ALTER TABLE kiosks ADD COLUMN pending_scan_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE kiosks ADD COLUMN last_sync_at TEXT;
ALTER TABLE kiosks ADD COLUMN last_sync_error TEXT;
