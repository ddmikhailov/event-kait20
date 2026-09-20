-- Add the shared Activity/Active domain without changing existing Event history.
CREATE TABLE seasons (
    id CHAR(36) NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    starts_at DATETIME(3) NOT NULL,
    ends_at DATETIME(3) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT false,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    active_slot TINYINT GENERATED ALWAYS AS (CASE WHEN active THEN 1 ELSE NULL END) VIRTUAL,
    PRIMARY KEY (id),
    UNIQUE INDEX seasons_code_key (code),
    UNIQUE INDEX seasons_single_active_key (active_slot),
    CONSTRAINT seasons_time_check CHECK (ends_at > starts_at)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE event_categories (
    id CHAR(36) NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX event_categories_code_key (code),
    CONSTRAINT event_categories_sort_check CHECK (sort_order >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE event_levels (
    id CHAR(36) NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX event_levels_code_key (code),
    CONSTRAINT event_levels_sort_check CHECK (sort_order >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE participation_roles (
    id CHAR(36) NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    built_in BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX participation_roles_code_key (code),
    CONSTRAINT participation_roles_sort_check CHECK (sort_order >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE participation_results (
    id CHAR(36) NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    description VARCHAR(500) NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    built_in BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX participation_results_code_key (code),
    CONSTRAINT participation_results_sort_check CHECK (sort_order >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE events
    ADD COLUMN season_id CHAR(36) NULL,
    ADD COLUMN category_id CHAR(36) NULL,
    ADD COLUMN level_id CHAR(36) NULL,
    ADD INDEX events_season_idx (season_id),
    ADD INDEX events_category_idx (category_id),
    ADD INDEX events_level_idx (level_id),
    ADD CONSTRAINT events_season_fk FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT events_category_fk FOREIGN KEY (category_id) REFERENCES event_categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT events_level_fk FOREIGN KEY (level_id) REFERENCES event_levels(id) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE participations (
    id CHAR(36) NOT NULL,
    person_id CHAR(36) NOT NULL,
    event_id CHAR(36) NOT NULL,
    registration_id CHAR(36) NOT NULL,
    stream_id CHAR(36) NULL,
    role_id CHAR(36) NULL,
    result_id CHAR(36) NULL,
    status ENUM('DRAFT', 'CONFIRMED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    source ENUM('ADMIN', 'ATTENDANCE_BULK', 'IMPORT') NOT NULL DEFAULT 'ADMIN',
    scoring_state ENUM('NOT_SCORED', 'AWARDED', 'NO_RULE', 'REVERSED') NOT NULL DEFAULT 'NOT_SCORED',
    scoring_cycle INTEGER NOT NULL DEFAULT 0,
    confirmed_at DATETIME(3) NULL,
    confirmed_by CHAR(36) NULL,
    finalized_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX participations_registration_key (registration_id),
    INDEX participations_person_status_idx (person_id, status),
    INDEX participations_event_status_idx (event_id, status),
    INDEX participations_role_idx (role_id),
    INDEX participations_result_idx (result_id),
    CONSTRAINT participations_cycle_check CHECK (scoring_cycle >= 0),
    CONSTRAINT participations_person_fk FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT participations_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT participations_registration_fk FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT participations_stream_fk FOREIGN KEY (stream_id) REFERENCES event_streams(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT participations_role_fk FOREIGN KEY (role_id) REFERENCES participation_roles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT participations_result_fk FOREIGN KEY (result_id) REFERENCES participation_results(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT participations_confirmed_by_fk FOREIGN KEY (confirmed_by) REFERENCES staff_users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE scoring_rules (
    id CHAR(36) NOT NULL,
    season_id CHAR(36) NOT NULL,
    event_category_id CHAR(36) NULL,
    event_level_id CHAR(36) NULL,
    participation_role_id CHAR(36) NULL,
    participation_result_id CHAR(36) NULL,
    points INTEGER NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true,
    valid_from DATETIME(3) NULL,
    valid_to DATETIME(3) NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    created_by CHAR(36) NOT NULL,
    updated_by CHAR(36) NOT NULL,
    active_match_key CHAR(64) GENERATED ALWAYS AS (
        CASE WHEN active THEN SHA2(CONCAT_WS(':', season_id, COALESCE(event_category_id, '*'),
            COALESCE(event_level_id, '*'), COALESCE(participation_role_id, '*'),
            COALESCE(participation_result_id, '*'), priority), 256) ELSE NULL END
    ) VIRTUAL,
    PRIMARY KEY (id),
    UNIQUE INDEX scoring_rules_active_match_key (active_match_key),
    INDEX scoring_rules_season_active_idx (season_id, active),
    CONSTRAINT scoring_rules_points_check CHECK (points <> 0),
    CONSTRAINT scoring_rules_priority_check CHECK (priority >= 0),
    CONSTRAINT scoring_rules_version_check CHECK (version > 0),
    CONSTRAINT scoring_rules_time_check CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
    CONSTRAINT scoring_rules_season_fk FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT scoring_rules_category_fk FOREIGN KEY (event_category_id) REFERENCES event_categories(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT scoring_rules_level_fk FOREIGN KEY (event_level_id) REFERENCES event_levels(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT scoring_rules_role_fk FOREIGN KEY (participation_role_id) REFERENCES participation_roles(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT scoring_rules_result_fk FOREIGN KEY (participation_result_id) REFERENCES participation_results(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT scoring_rules_created_by_fk FOREIGN KEY (created_by) REFERENCES staff_users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT scoring_rules_updated_by_fk FOREIGN KEY (updated_by) REFERENCES staff_users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE student_profiles (
    id CHAR(36) NOT NULL,
    person_id CHAR(36) NOT NULL,
    public_slug VARCHAR(100) NULL,
    visibility ENUM('PRIVATE', 'LINK_ONLY', 'PUBLIC') NOT NULL DEFAULT 'PRIVATE',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX student_profiles_person_key (person_id),
    UNIQUE INDEX student_profiles_public_slug_key (public_slug),
    CONSTRAINT student_profiles_person_fk FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE profile_publication_consents (
    id CHAR(36) NOT NULL,
    person_id CHAR(36) NOT NULL,
    consent_version VARCHAR(100) NOT NULL,
    allowed_fields JSON NOT NULL,
    accepted_at DATETIME(3) NOT NULL,
    withdrawn_at DATETIME(3) NULL,
    source ENUM('ADMIN', 'ACTIVE_UI', 'IMPORT') NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    INDEX profile_consents_person_idx (person_id, accepted_at),
    CONSTRAINT profile_consents_person_fk FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE achievements (
    id CHAR(36) NOT NULL,
    person_id CHAR(36) NOT NULL,
    event_id CHAR(36) NULL,
    participation_id CHAR(36) NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    achievement_type VARCHAR(80) NOT NULL,
    level_id CHAR(36) NULL,
    result_id CHAR(36) NULL,
    source ENUM('EVENT_KAIT20', 'MANUAL', 'IMPORT', 'EXTERNAL_SYSTEM') NOT NULL,
    status ENUM('DRAFT', 'PENDING', 'VERIFIED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    occurred_at DATETIME(3) NOT NULL,
    verified_at DATETIME(3) NULL,
    verified_by CHAR(36) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    INDEX achievements_person_status_idx (person_id, status),
    INDEX achievements_event_idx (event_id),
    INDEX achievements_participation_idx (participation_id),
    CONSTRAINT achievements_person_fk FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT achievements_event_fk FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT achievements_participation_fk FOREIGN KEY (participation_id) REFERENCES participations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT achievements_level_fk FOREIGN KEY (level_id) REFERENCES event_levels(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT achievements_result_fk FOREIGN KEY (result_id) REFERENCES participation_results(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT achievements_verified_by_fk FOREIGN KEY (verified_by) REFERENCES staff_users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE student_memberships (
    id CHAR(36) NOT NULL,
    person_id CHAR(36) NOT NULL,
    study_group VARCHAR(100) NOT NULL,
    department VARCHAR(150) NULL,
    valid_from DATE NOT NULL,
    valid_to DATE NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    INDEX student_memberships_person_period_idx (person_id, valid_from, valid_to),
    INDEX student_memberships_group_period_idx (study_group, valid_from, valid_to),
    CONSTRAINT student_memberships_time_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CONSTRAINT student_memberships_person_fk FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE score_transactions (
    id CHAR(36) NOT NULL,
    person_id CHAR(36) NOT NULL,
    season_id CHAR(36) NOT NULL,
    participation_id CHAR(36) NULL,
    achievement_id CHAR(36) NULL,
    scoring_rule_id CHAR(36) NULL,
    transaction_type ENUM('AWARD', 'REVERSAL', 'MANUAL_ADJUSTMENT', 'LEGACY_IMPORT') NOT NULL,
    points INTEGER NOT NULL,
    reason VARCHAR(500) NOT NULL,
    source ENUM('SCORING_ENGINE', 'ADMIN', 'IMPORT') NOT NULL,
    scoring_cycle INTEGER NULL,
    rule_version_snapshot INTEGER NULL,
    original_transaction_id CHAR(36) NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by CHAR(36) NULL,
    award_cycle_key VARCHAR(80) GENERATED ALWAYS AS (
        CASE WHEN transaction_type='AWARD' THEN CONCAT(participation_id, ':', scoring_cycle) ELSE NULL END
    ) VIRTUAL,
    PRIMARY KEY (id),
    UNIQUE INDEX score_transactions_idempotency_key (idempotency_key),
    UNIQUE INDEX score_transactions_original_key (original_transaction_id),
    UNIQUE INDEX score_transactions_award_cycle_key (award_cycle_key),
    INDEX score_transactions_person_season_idx (person_id, season_id, created_at),
    INDEX score_transactions_participation_idx (participation_id),
    CONSTRAINT score_transactions_points_check CHECK (points <> 0),
    CONSTRAINT score_transactions_cycle_check CHECK (scoring_cycle IS NULL OR scoring_cycle > 0),
    CONSTRAINT score_transactions_person_fk FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT score_transactions_season_fk FOREIGN KEY (season_id) REFERENCES seasons(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT score_transactions_participation_fk FOREIGN KEY (participation_id) REFERENCES participations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT score_transactions_achievement_fk FOREIGN KEY (achievement_id) REFERENCES achievements(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT score_transactions_rule_fk FOREIGN KEY (scoring_rule_id) REFERENCES scoring_rules(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT score_transactions_original_fk FOREIGN KEY (original_transaction_id) REFERENCES score_transactions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT score_transactions_created_by_fk FOREIGN KEY (created_by) REFERENCES staff_users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE domain_outbox (
    id CHAR(36) NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(100) NOT NULL,
    aggregate_id CHAR(36) NOT NULL,
    payload JSON NOT NULL,
    occurred_at DATETIME(3) NOT NULL,
    published_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    INDEX domain_outbox_pending_idx (published_at, occurred_at),
    INDEX domain_outbox_aggregate_idx (aggregate_type, aggregate_id)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO event_categories (id, code, name, description, active, sort_order, created_at, updated_at) VALUES
    ('10000000-0000-4000-8000-000000000001', 'GENERAL', 'Общее мероприятие', NULL, true, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT INTO event_levels (id, code, name, description, active, sort_order, created_at, updated_at) VALUES
    ('20000000-0000-4000-8000-000000000001', 'COLLEGE', 'Колледж', NULL, true, 10, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('20000000-0000-4000-8000-000000000002', 'DISTRICT', 'Район', NULL, true, 20, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('20000000-0000-4000-8000-000000000003', 'CITY', 'Город', NULL, true, 30, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('20000000-0000-4000-8000-000000000004', 'REGIONAL', 'Региональный', NULL, true, 40, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('20000000-0000-4000-8000-000000000005', 'FEDERAL', 'Федеральный', NULL, true, 50, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('20000000-0000-4000-8000-000000000006', 'INTERNATIONAL', 'Международный', NULL, true, 60, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT INTO participation_roles (id, code, name, description, active, built_in, sort_order, created_at, updated_at) VALUES
    ('30000000-0000-4000-8000-000000000001', 'PARTICIPANT', 'Участник', NULL, true, true, 10, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('30000000-0000-4000-8000-000000000002', 'COMPETITOR', 'Конкурсант', NULL, true, true, 20, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('30000000-0000-4000-8000-000000000003', 'VOLUNTEER', 'Волонтёр', NULL, true, true, 30, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('30000000-0000-4000-8000-000000000004', 'ORGANIZER', 'Организатор', NULL, true, true, 40, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('30000000-0000-4000-8000-000000000005', 'SPEAKER', 'Спикер', NULL, true, true, 50, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('30000000-0000-4000-8000-000000000006', 'MENTOR', 'Наставник', NULL, true, true, 60, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('30000000-0000-4000-8000-000000000007', 'CAPTAIN', 'Капитан', NULL, true, true, 70, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT INTO participation_results (id, code, name, description, active, built_in, sort_order, created_at, updated_at) VALUES
    ('40000000-0000-4000-8000-000000000001', 'WINNER', 'Победитель', NULL, true, true, 10, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('40000000-0000-4000-8000-000000000002', 'PRIZE_2', 'Призёр — 2 место', NULL, true, true, 20, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('40000000-0000-4000-8000-000000000003', 'PRIZE_3', 'Призёр — 3 место', NULL, true, true, 30, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('40000000-0000-4000-8000-000000000004', 'LAUREATE', 'Лауреат', NULL, true, true, 40, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('40000000-0000-4000-8000-000000000005', 'FINALIST', 'Финалист', NULL, true, true, 50, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('40000000-0000-4000-8000-000000000006', 'NOMINEE', 'Номинант', NULL, true, true, 60, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));
