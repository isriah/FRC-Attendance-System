INSERT INTO students (student_id, first_name, last_name, active, roster_hash, roster_synced_at)
VALUES ('100001', 'Bench', 'Student', 1, 'bench-seed', CURRENT_TIMESTAMP)
ON CONFLICT(student_id) DO UPDATE SET
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  active = 1,
  roster_hash = excluded.roster_hash,
  roster_synced_at = excluded.roster_synced_at;

INSERT INTO kiosks (kiosk_id, name, location, token_hash, active)
VALUES (
  'bench-01',
  'Bench Kiosk',
  'Raspberry Pi bench test',
  'c91cbbedf8c712e8e2b7517ddeca8fe4fde839ebd8339e0b2001363002b37712',
  1
)
ON CONFLICT(kiosk_id) DO UPDATE SET
  name = excluded.name,
  location = excluded.location,
  token_hash = excluded.token_hash,
  active = 1;
