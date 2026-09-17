ALTER TABLE `events`
    ADD COLUMN `direction` VARCHAR(80) NULL AFTER `description`;

CREATE INDEX `events_public_calendar_idx`
    ON `events` (`status`, `registration_deadline`, `start_at`);
