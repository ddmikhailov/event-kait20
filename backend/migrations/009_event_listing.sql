-- Existing events retain their previous catalogue visibility.
ALTER TABLE `events`
    ADD COLUMN `is_listed` BOOLEAN NOT NULL DEFAULT true,
    ADD INDEX `events_catalogue_idx` (`is_listed`, `status`, `registration_deadline`, `start_at`);
