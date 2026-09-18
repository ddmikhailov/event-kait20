-- Add participant categories introduced after the 1.0 baseline.
ALTER TABLE `persons`
    MODIFY COLUMN `person_type` ENUM(
        'KAIT_STUDENT',
        'KAIT_TEACHER',
        'EXTERNAL_STUDENT',
        'EXTERNAL_TEACHER',
        'PARENT',
        'OTHER'
    ) NOT NULL;

ALTER TABLE `registrations`
    MODIFY COLUMN `person_type` ENUM(
        'KAIT_STUDENT',
        'KAIT_TEACHER',
        'EXTERNAL_STUDENT',
        'EXTERNAL_TEACHER',
        'PARENT',
        'OTHER'
    ) NOT NULL;
