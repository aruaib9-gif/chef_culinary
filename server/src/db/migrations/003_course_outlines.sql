-- Course outlines uploaded by admins and downloadable by students: one per programme and one per course.
ALTER TABLE programmes ADD COLUMN outline_file_id BIGINT REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE courses ADD COLUMN outline_file_id BIGINT REFERENCES files(id) ON DELETE SET NULL;
