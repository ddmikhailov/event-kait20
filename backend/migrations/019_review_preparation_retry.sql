-- Additive queue diagnostics. Deploy before the application code.
-- Rollback: previous code tolerates these columns; retain them and their data.
ALTER TABLE events
    ADD COLUMN review_preparation_error VARCHAR(80) NULL,
    ADD COLUMN review_retry_at DATETIME(3) NULL,
    ADD INDEX events_review_retry_idx (activity_review_state, review_retry_at, end_at);
