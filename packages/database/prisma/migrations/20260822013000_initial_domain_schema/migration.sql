-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "person_type" AS ENUM ('KAIT_STUDENT', 'KAIT_TEACHER', 'EXTERNAL_STUDENT', 'EXTERNAL_TEACHER');
CREATE TYPE "event_status" AS ENUM ('DRAFT', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'ACTIVE', 'COMPLETED', 'ARCHIVED');
CREATE TYPE "event_form_field_type" AS ENUM ('SHORT_TEXT', 'LONG_TEXT', 'SINGLE_CHOICE', 'MULTI_CHOICE', 'BOOLEAN');
CREATE TYPE "registration_source" AS ENUM ('PUBLIC_FORM', 'EXCEL_IMPORT', 'ONSITE', 'ADMIN_MANUAL');
CREATE TYPE "registration_status" AS ENUM ('ACTIVE', 'ANNULLED');
CREATE TYPE "attendance_mode" AS ENUM ('MANUAL_CONFIRM', 'FAST_SCAN', 'MANUAL_SEARCH', 'ONSITE_REGISTRATION');
CREATE TYPE "attendance_source" AS ENUM ('ONLINE', 'OFFLINE_SYNC');
CREATE TYPE "staff_role" AS ENUM ('SUPER_ADMIN', 'SCANNER');
CREATE TYPE "event_access_role" AS ENUM ('SCANNER', 'EVENT_ADMIN');
CREATE TYPE "email_delivery_type" AS ENUM ('REGISTRATION_TICKET', 'STAFF_INVITATION', 'PASSWORD_RESET');
CREATE TYPE "email_delivery_status" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'FAILED');
CREATE TYPE "import_job_status" AS ENUM ('PENDING', 'PREVIEW_READY', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "persons" (
    "id" UUID NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "middle_name" VARCHAR(100),
    "birth_date" DATE,
    "email" VARCHAR(320),
    "email_normalized" VARCHAR(320),
    "phone" VARCHAR(32),
    "phone_normalized" VARCHAR(32),
    "person_type" "person_type" NOT NULL,
    "organization" VARCHAR(255),
    "study_group" VARCHAR(100),
    "dedup_review_required" BOOLEAN NOT NULL DEFAULT false,
    "merged_into_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "persons_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "slug" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "cover_object_key" VARCHAR(1024),
    "start_at" TIMESTAMPTZ(3) NOT NULL,
    "end_at" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Europe/Moscow',
    "location" VARCHAR(500) NOT NULL,
    "registration_deadline" TIMESTAMPTZ(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" "event_status" NOT NULL,
    "created_by" UUID NOT NULL,
    "offline_data_version" BIGINT NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "events_capacity_positive_check" CHECK ("capacity" > 0)
);

CREATE TABLE "event_form_fields" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "type" "event_form_field_type" NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,
    "options" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "event_form_fields_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "public_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "source" "registration_source" NOT NULL,
    "status" "registration_status" NOT NULL DEFAULT 'ACTIVE',
    "last_name" VARCHAR(100) NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "middle_name" VARCHAR(100),
    "birth_date" DATE,
    "email" VARCHAR(320),
    "phone" VARCHAR(32),
    "study_group" VARCHAR(100),
    "person_type" "person_type" NOT NULL,
    "organization" VARCHAR(255),
    "consent_accepted" BOOLEAN NOT NULL,
    "consent_version" VARCHAR(255),
    "consent_url" VARCHAR(2048),
    "consent_accepted_at" TIMESTAMPTZ(3),
    "registered_at" TIMESTAMPTZ(3) NOT NULL,
    "first_attended_at" TIMESTAMPTZ(3),
    "annulled_at" TIMESTAMPTZ(3),
    "annulled_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "registration_answers" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "field_label_snapshot" VARCHAR(255) NOT NULL,
    "field_type_snapshot" "event_form_field_type" NOT NULL,
    "answer" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "registration_answers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attendance_events" (
    "id" UUID NOT NULL,
    "client_event_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "scanner_user_id" UUID,
    "device_id" UUID,
    "mode" "attendance_mode" NOT NULL,
    "source" "attendance_source" NOT NULL,
    "device_scanned_at" TIMESTAMPTZ(3) NOT NULL,
    "estimated_scanned_at" TIMESTAMPTZ(3) NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "duplicate" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "attendance_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staff_users" (
    "id" UUID NOT NULL,
    "person_id" UUID,
    "email" VARCHAR(320) NOT NULL,
    "email_normalized" VARCHAR(320) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "system_role" "staff_role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "event_access" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "event_access_role" NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_access_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "staff_invitations" (
    "id" UUID NOT NULL,
    "email_normalized" VARCHAR(320) NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "invited_by" UUID NOT NULL,
    "event_id" UUID,
    "role" "staff_role" NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "diagnostic_metadata" JSONB,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL,
    "idempotency_key" VARCHAR(255) NOT NULL,
    "type" "email_delivery_type" NOT NULL,
    "recipient_email" VARCHAR(320) NOT NULL,
    "event_id" UUID,
    "registration_id" UUID,
    "staff_user_id" UUID,
    "status" "email_delivery_status" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" VARCHAR(255),
    "provider_message_id" VARCHAR(255),
    "queued_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "import_jobs" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "status" "import_job_status" NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
    "result_summary" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" VARCHAR(255) NOT NULL,
    "entity_type" VARCHAR(255) NOT NULL,
    "entity_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "persons_email_normalized_idx" ON "persons"("email_normalized");
CREATE INDEX "persons_phone_normalized_idx" ON "persons"("phone_normalized");
CREATE INDEX "persons_birth_date_idx" ON "persons"("birth_date");
CREATE INDEX "persons_name_idx" ON "persons"("last_name", "first_name", "middle_name");
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");
CREATE INDEX "event_form_fields_event_id_idx" ON "event_form_fields"("event_id");
CREATE UNIQUE INDEX "registrations_public_id_key" ON "registrations"("public_id");
CREATE INDEX "registrations_event_id_status_idx" ON "registrations"("event_id", "status");
CREATE INDEX "registrations_event_id_last_name_idx" ON "registrations"("event_id", "last_name");
CREATE INDEX "registrations_event_id_phone_idx" ON "registrations"("event_id", "phone");
CREATE INDEX "registrations_event_id_email_idx" ON "registrations"("event_id", "email");
CREATE INDEX "registrations_event_id_study_group_idx" ON "registrations"("event_id", "study_group");
CREATE INDEX "registrations_person_id_idx" ON "registrations"("person_id");

-- Prisma cannot represent this partial unique index declaratively. It permits
-- historical ANNULLED rows while enforcing one ACTIVE row per Event/Person.
CREATE UNIQUE INDEX "registrations_event_id_person_id_active_key"
ON "registrations"("event_id", "person_id")
WHERE "status" = 'ACTIVE';

CREATE INDEX "registration_answers_registration_id_idx" ON "registration_answers"("registration_id");
CREATE INDEX "registration_answers_field_id_idx" ON "registration_answers"("field_id");
CREATE UNIQUE INDEX "registration_answers_registration_id_field_id_key" ON "registration_answers"("registration_id", "field_id");
CREATE UNIQUE INDEX "attendance_events_client_event_id_key" ON "attendance_events"("client_event_id");
CREATE INDEX "attendance_events_registration_id_idx" ON "attendance_events"("registration_id");
CREATE INDEX "attendance_events_event_id_estimated_scanned_at_idx" ON "attendance_events"("event_id", "estimated_scanned_at");
CREATE UNIQUE INDEX "staff_users_email_normalized_key" ON "staff_users"("email_normalized");
CREATE INDEX "staff_users_person_id_idx" ON "staff_users"("person_id");
CREATE INDEX "event_access_user_id_idx" ON "event_access"("user_id");
CREATE UNIQUE INDEX "event_access_event_id_user_id_key" ON "event_access"("event_id", "user_id");
CREATE UNIQUE INDEX "staff_invitations_token_hash_key" ON "staff_invitations"("token_hash");
CREATE INDEX "staff_invitations_email_normalized_idx" ON "staff_invitations"("email_normalized");
CREATE INDEX "staff_invitations_event_id_idx" ON "staff_invitations"("event_id");
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");
CREATE UNIQUE INDEX "email_deliveries_idempotency_key_key" ON "email_deliveries"("idempotency_key");
CREATE INDEX "email_deliveries_status_idx" ON "email_deliveries"("status");
CREATE INDEX "email_deliveries_event_id_idx" ON "email_deliveries"("event_id");
CREATE INDEX "email_deliveries_registration_id_idx" ON "email_deliveries"("registration_id");
CREATE INDEX "email_deliveries_staff_user_id_idx" ON "email_deliveries"("staff_user_id");
CREATE INDEX "import_jobs_event_id_idx" ON "import_jobs"("event_id");
CREATE INDEX "import_jobs_created_by_idx" ON "import_jobs"("created_by");
CREATE INDEX "audit_log_actor_user_id_idx" ON "audit_log"("actor_user_id");
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- AddForeignKey. Historical business entities use RESTRICT rather than
-- destructive cascading deletes. Key updates remain explicit CASCADE updates.
ALTER TABLE "persons" ADD CONSTRAINT "persons_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_form_fields" ADD CONSTRAINT "event_form_fields_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_annulled_by_fkey" FOREIGN KEY ("annulled_by") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registration_answers" ADD CONSTRAINT "registration_answers_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "registration_answers" ADD CONSTRAINT "registration_answers_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "event_form_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_scanner_user_id_fkey" FOREIGN KEY ("scanner_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "persons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_access" ADD CONSTRAINT "event_access_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_access" ADD CONSTRAINT "event_access_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "event_access" ADD CONSTRAINT "event_access_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "staff_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
