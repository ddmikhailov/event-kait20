-- Release 1.0 shared rate-limit buckets. Identifiers are HMACed by the API.
CREATE TABLE `security_rate_limits` (
    `bucket_key` CHAR(64) NOT NULL,
    `attempts` INTEGER UNSIGNED NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    INDEX `security_rate_limits_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`bucket_key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
