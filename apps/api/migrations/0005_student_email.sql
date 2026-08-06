ALTER TABLE students ADD COLUMN email TEXT;

CREATE UNIQUE INDEX students_email_unique_idx
ON students(email)
WHERE email IS NOT NULL;
