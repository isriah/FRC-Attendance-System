ALTER TABLE students ADD COLUMN attendance_required_from_date TEXT;

UPDATE students
SET attendance_required_from_date = COALESCE(
  NULLIF(substr(roster_synced_at, 1, 10), ''),
  date('now')
)
WHERE attendance_required_from_date IS NULL;

