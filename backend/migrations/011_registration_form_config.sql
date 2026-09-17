-- NULL preserves the existing r2 form; new Events receive optional-field defaults in the API.
ALTER TABLE events ADD COLUMN form_config JSON NULL;
ALTER TABLE event_form_fields ADD COLUMN onsite_required BOOLEAN NULL;

-- A retry receipt, not a second copy of participant data. No raw request capability is stored.
CREATE TABLE registration_requests (
    request_hash CHAR(64) NOT NULL PRIMARY KEY,
    event_id CHAR(36) NOT NULL,
    registration_id CHAR(36) NOT NULL,
    payload_hash CHAR(64) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX registration_requests_event (event_id),
    CONSTRAINT registration_requests_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
    CONSTRAINT registration_requests_registration_fk FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
