-- Migration 0015 used the UTC calendar portion of roster_synced_at. Correct only
-- values it derived, preserving any intentionally changed requirement date.
UPDATE students
SET attendance_required_from_date = date(
  roster_synced_at,
  CASE
    WHEN julianday(roster_synced_at) >= julianday(printf(
      '%04d-03-%02d 07:00:00',
      CAST(strftime('%Y', roster_synced_at) AS INTEGER),
      8 + ((7 - CAST(strftime('%w', printf('%04d-03-01', CAST(strftime('%Y', roster_synced_at) AS INTEGER))) AS INTEGER)) % 7)
    ))
    AND julianday(roster_synced_at) < julianday(printf(
      '%04d-11-%02d 06:00:00',
      CAST(strftime('%Y', roster_synced_at) AS INTEGER),
      1 + ((7 - CAST(strftime('%w', printf('%04d-11-01', CAST(strftime('%Y', roster_synced_at) AS INTEGER))) AS INTEGER)) % 7)
    ))
    THEN '-4 hours'
    ELSE '-5 hours'
  END
)
WHERE roster_synced_at IS NOT NULL
  AND attendance_required_from_date = substr(roster_synced_at, 1, 10);
