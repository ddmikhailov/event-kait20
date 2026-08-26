-- CreateTable
CREATE TABLE `persons` (
    `id` CHAR(36) NOT NULL,
    `last_name` VARCHAR(100) NOT NULL,
    `first_name` VARCHAR(100) NOT NULL,
    `middle_name` VARCHAR(100) NULL,
    `birth_date` DATE NULL,
    `email` VARCHAR(320) NULL,
    `email_normalized` VARCHAR(320) NULL,
    `phone` VARCHAR(32) NULL,
    `phone_normalized` VARCHAR(32) NULL,
    `person_type` ENUM('KAIT_STUDENT', 'KAIT_TEACHER', 'EXTERNAL_STUDENT', 'EXTERNAL_TEACHER') NOT NULL,
    `organization` VARCHAR(255) NULL,
    `study_group` VARCHAR(100) NULL,
    `dedup_review_required` BOOLEAN NOT NULL DEFAULT false,
    `merged_into_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `persons_email_normalized_idx`(`email_normalized`),
    INDEX `persons_phone_normalized_idx`(`phone_normalized`),
    INDEX `persons_birth_date_idx`(`birth_date`),
    INDEX `persons_name_idx`(`last_name`, `first_name`, `middle_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `events` (
    `id` CHAR(36) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `slug` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `cover_object_key` VARCHAR(1024) NULL,
    `start_at` DATETIME(3) NOT NULL,
    `end_at` DATETIME(3) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',
    `location` VARCHAR(500) NOT NULL,
    `registration_deadline` DATETIME(3) NOT NULL,
    `capacity` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ACTIVE', 'COMPLETED', 'ARCHIVED') NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `offline_data_version` BIGINT NOT NULL DEFAULT 1,
    `archived_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `events_slug_key`(`slug`),
    CONSTRAINT `events_capacity_positive_check` CHECK (`capacity` > 0),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_form_fields` (
    `id` CHAR(36) NOT NULL,
    `event_id` CHAR(36) NOT NULL,
    `type` ENUM('SHORT_TEXT', 'LONG_TEXT', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'BOOLEAN') NOT NULL,
    `label` VARCHAR(255) NOT NULL,
    `required` BOOLEAN NOT NULL DEFAULT false,
    `sort_order` INTEGER NOT NULL,
    `options` JSON NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `event_form_fields_event_id_idx`(`event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `registrations` (
    `id` CHAR(36) NOT NULL,
    `public_id` CHAR(36) NOT NULL,
    `event_id` CHAR(36) NOT NULL,
    `person_id` CHAR(36) NOT NULL,
    `source` ENUM('PUBLIC_FORM', 'EXCEL_IMPORT', 'ONSITE', 'ADMIN_MANUAL') NOT NULL,
    `status` ENUM('ACTIVE', 'ANNULLED') NOT NULL DEFAULT 'ACTIVE',
    `last_name` VARCHAR(100) NOT NULL,
    `first_name` VARCHAR(100) NOT NULL,
    `middle_name` VARCHAR(100) NULL,
    `birth_date` DATE NULL,
    `email` VARCHAR(320) NULL,
    `phone` VARCHAR(32) NULL,
    `study_group` VARCHAR(100) NULL,
    `person_type` ENUM('KAIT_STUDENT', 'KAIT_TEACHER', 'EXTERNAL_STUDENT', 'EXTERNAL_TEACHER') NOT NULL,
    `organization` VARCHAR(255) NULL,
    `consent_accepted` BOOLEAN NOT NULL,
    `consent_version` VARCHAR(255) NULL,
    `consent_url` VARCHAR(2048) NULL,
    `consent_accepted_at` DATETIME(3) NULL,
    `registered_at` DATETIME(3) NOT NULL,
    `first_attended_at` DATETIME(3) NULL,
    `annulled_at` DATETIME(3) NULL,
    `annulled_by` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `active_registration` TINYINT GENERATED ALWAYS AS (
        CASE WHEN `status` = 'ACTIVE' THEN 1 ELSE NULL END
    ) VIRTUAL,

    UNIQUE INDEX `registrations_public_id_key`(`public_id`),
    UNIQUE INDEX `registrations_event_id_person_id_active_key`(`event_id`, `person_id`, `active_registration`),
    INDEX `registrations_event_id_status_idx`(`event_id`, `status`),
    INDEX `registrations_event_id_last_name_idx`(`event_id`, `last_name`),
    INDEX `registrations_event_id_phone_idx`(`event_id`, `phone`),
    INDEX `registrations_event_id_email_idx`(`event_id`, `email`),
    INDEX `registrations_event_id_study_group_idx`(`event_id`, `study_group`),
    INDEX `registrations_person_id_idx`(`person_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `registration_answers` (
    `id` CHAR(36) NOT NULL,
    `registration_id` CHAR(36) NOT NULL,
    `field_id` CHAR(36) NOT NULL,
    `field_label_snapshot` VARCHAR(255) NOT NULL,
    `field_type_snapshot` ENUM('SHORT_TEXT', 'LONG_TEXT', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'BOOLEAN') NOT NULL,
    `answer` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `registration_answers_registration_id_idx`(`registration_id`),
    INDEX `registration_answers_field_id_idx`(`field_id`),
    UNIQUE INDEX `registration_answers_registration_id_field_id_key`(`registration_id`, `field_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_events` (
    `id` CHAR(36) NOT NULL,
    `client_event_id` CHAR(36) NOT NULL,
    `event_id` CHAR(36) NOT NULL,
    `registration_id` CHAR(36) NOT NULL,
    `scanner_user_id` CHAR(36) NULL,
    `device_id` CHAR(36) NULL,
    `mode` ENUM('MANUAL_CONFIRM', 'FAST_SCAN', 'MANUAL_SEARCH', 'ONSITE_REGISTRATION') NOT NULL,
    `source` ENUM('ONLINE', 'OFFLINE_SYNC') NOT NULL,
    `device_scanned_at` DATETIME(3) NOT NULL,
    `estimated_scanned_at` DATETIME(3) NOT NULL,
    `received_at` DATETIME(3) NOT NULL,
    `duplicate` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `attendance_events_client_event_id_key`(`client_event_id`),
    INDEX `attendance_events_registration_id_idx`(`registration_id`),
    INDEX `attendance_events_event_id_estimated_scanned_at_idx`(`event_id`, `estimated_scanned_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staff_users` (
    `id` CHAR(36) NOT NULL,
    `person_id` CHAR(36) NULL,
    `email` VARCHAR(320) NOT NULL,
    `email_normalized` VARCHAR(320) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `system_role` ENUM('SUPER_ADMIN', 'SCANNER') NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `last_login_at` DATETIME(3) NULL,
    `password_changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `staff_users_email_normalized_key`(`email_normalized`),
    INDEX `staff_users_person_id_idx`(`person_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `event_access` (
    `id` CHAR(36) NOT NULL,
    `event_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role` ENUM('SCANNER', 'EVENT_ADMIN') NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `event_access_user_id_idx`(`user_id`),
    UNIQUE INDEX `event_access_event_id_user_id_key`(`event_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `staff_invitations` (
    `id` CHAR(36) NOT NULL,
    `email_normalized` VARCHAR(320) NOT NULL,
    `token_hash` VARCHAR(255) NOT NULL,
    `invited_by` CHAR(36) NOT NULL,
    `event_id` CHAR(36) NULL,
    `role` ENUM('SUPER_ADMIN', 'SCANNER') NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `accepted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `staff_invitations_token_hash_key`(`token_hash`),
    INDEX `staff_invitations_email_normalized_idx`(`email_normalized`),
    INDEX `staff_invitations_event_id_idx`(`event_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_hash` VARCHAR(255) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `diagnostic_metadata` JSON NULL,

    UNIQUE INDEX `sessions_token_hash_key`(`token_hash`),
    INDEX `sessions_user_id_idx`(`user_id`),
    INDEX `sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_reset_tokens` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `token_hash` VARCHAR(255) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `password_reset_tokens_token_hash_key`(`token_hash`),
    INDEX `password_reset_tokens_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `email_deliveries` (
    `id` CHAR(36) NOT NULL,
    `idempotency_key` VARCHAR(255) NOT NULL,
    `type` ENUM('REGISTRATION_TICKET', 'STAFF_INVITATION', 'PASSWORD_RESET') NOT NULL,
    `recipient_email` VARCHAR(320) NOT NULL,
    `event_id` CHAR(36) NULL,
    `registration_id` CHAR(36) NULL,
    `staff_user_id` CHAR(36) NULL,
    `staff_invitation_id` CHAR(36) NULL,
    `password_reset_token_id` CHAR(36) NULL,
    `status` ENUM('QUEUED', 'SENDING', 'SENT', 'FAILED') NOT NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `last_error_code` VARCHAR(255) NULL,
    `provider_message_id` VARCHAR(255) NULL,
    `queued_at` DATETIME(3) NOT NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `email_deliveries_idempotency_key_key`(`idempotency_key`),
    INDEX `email_deliveries_status_idx`(`status`),
    INDEX `email_deliveries_event_id_idx`(`event_id`),
    INDEX `email_deliveries_registration_id_idx`(`registration_id`),
    INDEX `email_deliveries_staff_user_id_idx`(`staff_user_id`),
    INDEX `email_deliveries_staff_invitation_id_idx`(`staff_invitation_id`),
    INDEX `email_deliveries_password_reset_token_id_idx`(`password_reset_token_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_jobs` (
    `id` CHAR(36) NOT NULL,
    `event_id` CHAR(36) NOT NULL,
    `created_by` CHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'PREVIEW_READY', 'COMPLETED', 'FAILED', 'EXPIRED') NOT NULL,
    `total_rows` INTEGER NOT NULL DEFAULT 0,
    `valid_rows` INTEGER NOT NULL DEFAULT 0,
    `error_rows` INTEGER NOT NULL DEFAULT 0,
    `duplicate_rows` INTEGER NOT NULL DEFAULT 0,
    `result_summary` JSON NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `committed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `import_jobs_event_id_idx`(`event_id`),
    INDEX `import_jobs_created_by_idx`(`created_by`),
    INDEX `import_jobs_status_expires_at_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_job_files` (
    `import_job_id` CHAR(36) NOT NULL,
    `file_data` LONGBLOB NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `import_job_files_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`import_job_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_log` (
    `id` CHAR(36) NOT NULL,
    `actor_user_id` CHAR(36) NULL,
    `action` VARCHAR(255) NOT NULL,
    `entity_type` VARCHAR(255) NOT NULL,
    `entity_id` CHAR(36) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_actor_user_id_idx`(`actor_user_id`),
    INDEX `audit_log_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    INDEX `audit_log_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `persons` ADD CONSTRAINT `persons_merged_into_id_fkey` FOREIGN KEY (`merged_into_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `events` ADD CONSTRAINT `events_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_form_fields` ADD CONSTRAINT `event_form_fields_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registrations` ADD CONSTRAINT `registrations_annulled_by_fkey` FOREIGN KEY (`annulled_by`) REFERENCES `staff_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registration_answers` ADD CONSTRAINT `registration_answers_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `registration_answers` ADD CONSTRAINT `registration_answers_field_id_fkey` FOREIGN KEY (`field_id`) REFERENCES `event_form_fields`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_events` ADD CONSTRAINT `attendance_events_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_events` ADD CONSTRAINT `attendance_events_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_events` ADD CONSTRAINT `attendance_events_scanner_user_id_fkey` FOREIGN KEY (`scanner_user_id`) REFERENCES `staff_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staff_users` ADD CONSTRAINT `staff_users_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_access` ADD CONSTRAINT `event_access_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_access` ADD CONSTRAINT `event_access_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `event_access` ADD CONSTRAINT `event_access_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staff_invitations` ADD CONSTRAINT `staff_invitations_invited_by_fkey` FOREIGN KEY (`invited_by`) REFERENCES `staff_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `staff_invitations` ADD CONSTRAINT `staff_invitations_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_reset_tokens` ADD CONSTRAINT `password_reset_tokens_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `staff_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_deliveries` ADD CONSTRAINT `email_deliveries_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_deliveries` ADD CONSTRAINT `email_deliveries_registration_id_fkey` FOREIGN KEY (`registration_id`) REFERENCES `registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_deliveries` ADD CONSTRAINT `email_deliveries_staff_user_id_fkey` FOREIGN KEY (`staff_user_id`) REFERENCES `staff_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_deliveries` ADD CONSTRAINT `email_deliveries_staff_invitation_id_fkey` FOREIGN KEY (`staff_invitation_id`) REFERENCES `staff_invitations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `email_deliveries` ADD CONSTRAINT `email_deliveries_password_reset_token_id_fkey` FOREIGN KEY (`password_reset_token_id`) REFERENCES `password_reset_tokens`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_jobs` ADD CONSTRAINT `import_jobs_event_id_fkey` FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_jobs` ADD CONSTRAINT `import_jobs_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `staff_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_job_files` ADD CONSTRAINT `import_job_files_import_job_id_fkey` FOREIGN KEY (`import_job_id`) REFERENCES `import_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `staff_users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
