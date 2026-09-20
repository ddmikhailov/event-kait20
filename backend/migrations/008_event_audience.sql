-- NULL preserves unrestricted registration for existing events.
ALTER TABLE `events` ADD COLUMN `allowed_person_types` JSON NULL;
