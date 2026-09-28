-- Durable operator handoff for rejected Scanner marks. Additive, no attendance
-- or scoring rows are changed. Deploy before the corresponding application.
-- Rollback: old application ignores this table; retain it and its history.
CREATE TABLE scanner_rejected_attendance (
    client_event_id CHAR(36) PRIMARY KEY,
    event_id CHAR(36) NOT NULL,
    registration_id CHAR(36) NOT NULL,
    scanner_user_id CHAR(36) NOT NULL,
    device_id CHAR(36) NOT NULL,
    mode VARCHAR(32) NOT NULL,
    source VARCHAR(16) NOT NULL,
    device_scanned_at DATETIME(3) NOT NULL,
    estimated_scanned_at DATETIME(3) NOT NULL,
    rejection_status VARCHAR(40) NOT NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'OPEN',
    resolved_by CHAR(36) NULL,
    resolution_reason VARCHAR(500) NULL,
    created_at DATETIME(3) NOT NULL,
    resolved_at DATETIME(3) NULL,
    CONSTRAINT rejected_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    CONSTRAINT rejected_scanner_fk FOREIGN KEY (scanner_user_id) REFERENCES staff_users(id),
    CONSTRAINT rejected_resolver_fk FOREIGN KEY (resolved_by) REFERENCES staff_users(id),
    CONSTRAINT rejected_status_ck CHECK (status IN ('OPEN','RESOLVED')),
    CONSTRAINT rejected_reason_ck CHECK (rejection_status IN
      ('INVALID_REGISTRATION','REGISTRATION_ANNULLED','INVALID_TIMESTAMP','CLIENT_EVENT_CONFLICT')),
    INDEX rejected_event_status_idx (event_id, status, created_at)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
