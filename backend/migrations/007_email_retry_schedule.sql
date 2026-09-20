-- Preserve delivery history while spacing transient SMTP retries.
ALTER TABLE `email_deliveries`
    ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
    ADD INDEX `email_deliveries_retry_idx` (`status`, `next_attempt_at`, `queued_at`);
