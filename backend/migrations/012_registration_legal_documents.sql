ALTER TABLE `registrations`
    ADD COLUMN `privacy_policy_url` VARCHAR(2048) NULL AFTER `consent_url`;
