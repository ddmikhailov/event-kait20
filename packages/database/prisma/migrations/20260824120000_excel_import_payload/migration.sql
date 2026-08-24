ALTER TABLE "import_jobs"
  ADD COLUMN "expires_at" TIMESTAMPTZ(3) NOT NULL
    DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
  ADD COLUMN "committed_at" TIMESTAMPTZ(3);

ALTER TABLE "import_jobs" ALTER COLUMN "expires_at" DROP DEFAULT;

CREATE INDEX "import_jobs_status_expires_at_idx"
  ON "import_jobs" ("status", "expires_at");

CREATE TABLE "import_job_files" (
  "import_job_id" UUID NOT NULL,
  "file_data" BYTEA NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "import_job_files_pkey" PRIMARY KEY ("import_job_id"),
  CONSTRAINT "import_job_files_import_job_id_fkey"
    FOREIGN KEY ("import_job_id") REFERENCES "import_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "import_job_files_expires_at_idx"
  ON "import_job_files" ("expires_at");
