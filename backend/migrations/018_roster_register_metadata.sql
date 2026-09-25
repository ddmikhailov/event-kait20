-- Additive storage for the seven-column college roster. Rollback requires an
-- export of these private fields before dropping them; profile scores are unaffected.
ALTER TABLE student_roster_members
    ADD COLUMN education_status VARCHAR(120) NULL,
    ADD COLUMN campus_address VARCHAR(120) NULL,
    ADD COLUMN course_label VARCHAR(120) NULL,
    ADD COLUMN program_name VARCHAR(120) NULL,
    ADD COLUMN program_code VARCHAR(120) NULL;
