-- Additive EventKAIT20 MosActive review workflow. Rollback requires the
-- application to stop creating reviews, an export of decisions/audit evidence,
-- then removal of the review tables/columns. Never rewrite existing scores.
ALTER TABLE events
    ADD COLUMN boost_multiplier DECIMAL(3,1) NOT NULL DEFAULT 1.0,
    ADD COLUMN activity_review_required BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN activity_review_state ENUM('NOT_STARTED','PENDING','APPROVED') NOT NULL DEFAULT 'NOT_STARTED',
    ADD COLUMN activity_reviewed_at DATETIME(3) NULL,
    ADD COLUMN activity_reviewed_by CHAR(36) NULL,
    ADD CONSTRAINT events_activity_reviewed_by_fk
      FOREIGN KEY (activity_reviewed_by) REFERENCES staff_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT events_boost_multiplier_check
      CHECK (boost_multiplier IN (1.0, 1.5, 2.0, 3.0));

-- In-progress Events without finalized activity join the new review path.
-- Finished/historical Events keep their existing ledger and correction flow.
UPDATE events e SET e.activity_review_required=true
WHERE e.status IN ('DRAFT','REGISTRATION_OPEN','REGISTRATION_CLOSED','ACTIVE')
  AND NOT EXISTS (
    SELECT 1 FROM participations p
    WHERE p.event_id=e.id AND p.status='CONFIRMED'
  );

CREATE TABLE student_roster_members (
    person_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by CHAR(36) NULL,
    PRIMARY KEY (person_id),
    CONSTRAINT student_roster_person_fk FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT student_roster_actor_fk FOREIGN KEY (created_by) REFERENCES staff_users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE registrations
    ADD COLUMN roster_match_state ENUM('NOT_APPLICABLE','MATCHED','UNMATCHED','AMBIGUOUS','REJECTED') NOT NULL DEFAULT 'NOT_APPLICABLE',
    ADD COLUMN roster_person_id CHAR(36) NULL,
    ADD INDEX registrations_roster_match_idx (event_id,roster_match_state),
    ADD CONSTRAINT registrations_roster_person_fk FOREIGN KEY (roster_person_id) REFERENCES persons(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE event_participation_reviews (
    registration_id CHAR(36) NOT NULL,
    event_id CHAR(36) NOT NULL,
    attendance_decision ENUM('PRESENT','ABSENT') NOT NULL,
    scanner_first_attended_at DATETIME(3) NULL,
    role_id CHAR(36) NOT NULL,
    result_id CHAR(36) NULL,
    roster_person_id CHAR(36) NULL,
    match_state ENUM('NOT_APPLICABLE','MATCHED','UNMATCHED','AMBIGUOUS','REJECTED') NOT NULL,
    decision_reason VARCHAR(500) NULL,
    reviewed_by CHAR(36) NULL,
    reviewed_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (registration_id),
    INDEX event_participation_reviews_event_idx (event_id,match_state),
    CONSTRAINT event_reviews_registration_fk FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT event_reviews_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT event_reviews_role_fk FOREIGN KEY (role_id) REFERENCES participation_roles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT event_reviews_result_fk FOREIGN KEY (result_id) REFERENCES participation_results(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT event_reviews_roster_person_fk FOREIGN KEY (roster_person_id) REFERENCES persons(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT event_reviews_actor_fk FOREIGN KEY (reviewed_by) REFERENCES staff_users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

UPDATE event_levels SET name='На отделении',updated_at=UTC_TIMESTAMP(3)
WHERE code='DEPARTMENT';
UPDATE event_levels SET name='Внутриколледжный',updated_at=UTC_TIMESTAMP(3)
WHERE code='COLLEGE';
UPDATE event_levels SET name='Городской',updated_at=UTC_TIMESTAMP(3)
WHERE code='CITY';
INSERT INTO event_levels
    (id,code,name,description,active,sort_order,created_at,updated_at)
VALUES
    ('20000000-0000-4000-8000-000000000008','OKRUG','Окружной',NULL,true,45,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
