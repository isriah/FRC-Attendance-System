ALTER TABLE students ADD COLUMN discord_user_id TEXT;

CREATE UNIQUE INDEX students_discord_user_id_unique_idx
ON students(discord_user_id)
WHERE discord_user_id IS NOT NULL;
