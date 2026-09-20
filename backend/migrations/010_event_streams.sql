-- Existing events and registrations remain in single-session mode.
ALTER TABLE events ADD COLUMN streams_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE event_streams (
    id CHAR(36) NOT NULL,
    event_id CHAR(36) NOT NULL,
    title VARCHAR(200) NOT NULL,
    start_at DATETIME(3) NOT NULL,
    end_at DATETIME(3) NOT NULL,
    capacity INTEGER NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY event_streams_event_identity (id,event_id),
    INDEX event_streams_listing (event_id,active,sort_order),
    CONSTRAINT event_streams_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT,
    CONSTRAINT event_streams_capacity_check CHECK (capacity > 0),
    CONSTRAINT event_streams_time_check CHECK (end_at > start_at),
    CONSTRAINT event_streams_order_check CHECK (sort_order >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE registrations
    ADD COLUMN stream_id CHAR(36) NULL,
    ADD INDEX registrations_stream_status (stream_id,status),
    ADD CONSTRAINT registrations_stream_event_fk FOREIGN KEY (stream_id,event_id)
        REFERENCES event_streams(id,event_id) ON DELETE RESTRICT;
