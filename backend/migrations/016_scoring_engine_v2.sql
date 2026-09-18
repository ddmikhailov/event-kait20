-- MosActive Scoring Engine v2. Existing seasons remain on v1 until explicitly assigned.
ALTER TABLE score_transactions MODIFY points DECIMAL(12,4) NOT NULL;

CREATE TABLE scoring_policies (
    id CHAR(36) NOT NULL,
    organization_id CHAR(36) NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX scoring_policies_org_code_key (organization_id, code),
    CONSTRAINT scoring_policies_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE scoring_policy_versions (
    id CHAR(36) NOT NULL,
    scoring_policy_id CHAR(36) NOT NULL,
    version INTEGER NOT NULL,
    status ENUM('DRAFT','PUBLISHED','RETIRED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
    effective_from DATETIME(3) NULL,
    effective_to DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    published_at DATETIME(3) NULL,
    retired_at DATETIME(3) NULL,
    created_by CHAR(36) NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX scoring_policy_versions_key (scoring_policy_id, version),
    INDEX scoring_policy_versions_effective_idx (scoring_policy_id, status, effective_from, effective_to),
    CONSTRAINT scoring_policy_versions_time_check CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from),
    CONSTRAINT scoring_policy_versions_policy_fk FOREIGN KEY (scoring_policy_id) REFERENCES scoring_policies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT scoring_policy_versions_creator_fk FOREIGN KEY (created_by) REFERENCES staff_users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE person_status_types (
    id CHAR(36) NOT NULL, code VARCHAR(50) NOT NULL, name VARCHAR(150) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id), UNIQUE INDEX person_status_types_code_key (code)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE person_status_assignments (
    id CHAR(36) NOT NULL, person_id CHAR(36) NOT NULL, status_type_id CHAR(36) NOT NULL,
    valid_from DATE NOT NULL, valid_to DATE NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    created_by CHAR(36) NULL, retired_at DATETIME(3) NULL,
    retired_effective_on DATE NULL,
    PRIMARY KEY (id), INDEX person_status_assignments_lookup_idx (person_id,status_type_id,valid_from,valid_to,retired_at),
    CONSTRAINT person_status_assignments_time_check CHECK (valid_to IS NULL OR valid_to >= valid_from),
    CONSTRAINT person_status_assignments_retirement_check CHECK (
        (retired_at IS NULL AND retired_effective_on IS NULL)
        OR (retired_at IS NOT NULL AND retired_effective_on IS NOT NULL)
    ),
    CONSTRAINT person_status_assignments_person_fk FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT person_status_assignments_type_fk FOREIGN KEY (status_type_id) REFERENCES person_status_types(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT person_status_assignments_creator_fk FOREIGN KEY (created_by) REFERENCES staff_users(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE scoring_policy_role_bases (
    policy_version_id CHAR(36) NOT NULL, role_id CHAR(36) NOT NULL, value DECIMAL(12,4) NOT NULL,
    PRIMARY KEY (policy_version_id,role_id), CONSTRAINT scoring_role_value_check CHECK (value >= 0),
    CONSTRAINT scoring_role_version_fk FOREIGN KEY (policy_version_id) REFERENCES scoring_policy_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT scoring_role_role_fk FOREIGN KEY (role_id) REFERENCES participation_roles(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE scoring_policy_level_multipliers (
    policy_version_id CHAR(36) NOT NULL, level_id CHAR(36) NOT NULL, value DECIMAL(12,4) NOT NULL,
    PRIMARY KEY (policy_version_id,level_id), CONSTRAINT scoring_level_value_check CHECK (value > 0),
    CONSTRAINT scoring_level_version_fk FOREIGN KEY (policy_version_id) REFERENCES scoring_policy_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT scoring_level_level_fk FOREIGN KEY (level_id) REFERENCES event_levels(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE scoring_policy_status_multipliers (
    policy_version_id CHAR(36) NOT NULL, status_type_id CHAR(36) NOT NULL, value DECIMAL(12,4) NOT NULL,
    PRIMARY KEY (policy_version_id,status_type_id), CONSTRAINT scoring_status_value_check CHECK (value > 0),
    CONSTRAINT scoring_status_version_fk FOREIGN KEY (policy_version_id) REFERENCES scoring_policy_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT scoring_status_type_fk FOREIGN KEY (status_type_id) REFERENCES person_status_types(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE scoring_policy_newcomer_tiers (
    policy_version_id CHAR(36) NOT NULL, sequence_from INTEGER NOT NULL, sequence_to INTEGER NULL, value DECIMAL(12,4) NOT NULL,
    PRIMARY KEY (policy_version_id,sequence_from),
    CONSTRAINT scoring_newcomer_range_check CHECK (sequence_from > 0 AND (sequence_to IS NULL OR sequence_to >= sequence_from)),
    CONSTRAINT scoring_newcomer_value_check CHECK (value > 0),
    CONSTRAINT scoring_newcomer_version_fk FOREIGN KEY (policy_version_id) REFERENCES scoring_policy_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE scoring_policy_result_bonuses (
    policy_version_id CHAR(36) NOT NULL, result_id CHAR(36) NOT NULL, value DECIMAL(12,4) NOT NULL,
    PRIMARY KEY (policy_version_id,result_id),
    CONSTRAINT scoring_result_value_check CHECK (value >= 0),
    CONSTRAINT scoring_result_version_fk FOREIGN KEY (policy_version_id) REFERENCES scoring_policy_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT scoring_result_result_fk FOREIGN KEY (result_id) REFERENCES participation_results(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE seasons ADD COLUMN organization_id CHAR(36) NULL AFTER id,
    ADD COLUMN scoring_policy_id CHAR(36) NULL AFTER organization_id,
    ADD COLUMN scoring_policy_effective_from DATETIME(3) NULL AFTER scoring_policy_id;
UPDATE seasons SET organization_id='51000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
ALTER TABLE seasons MODIFY organization_id CHAR(36) NOT NULL,
    DROP INDEX seasons_code_key,
    DROP INDEX seasons_single_active_key,
    ADD COLUMN active_organization_key CHAR(36) GENERATED ALWAYS AS (CASE WHEN active THEN organization_id ELSE NULL END) VIRTUAL,
    ADD UNIQUE INDEX seasons_organization_code_key (organization_id,code),
    ADD UNIQUE INDEX seasons_organization_active_key (active_organization_key),
    ADD INDEX seasons_scoring_policy_idx (scoring_policy_id),
    ADD CONSTRAINT seasons_scoring_policy_boundary_check CHECK (
        (scoring_policy_id IS NULL AND scoring_policy_effective_from IS NULL)
        OR (scoring_policy_id IS NOT NULL AND scoring_policy_effective_from IS NOT NULL)
    ),
    ADD CONSTRAINT seasons_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT seasons_scoring_policy_fk FOREIGN KEY (scoring_policy_id) REFERENCES scoring_policies(id) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE participations ADD COLUMN scoring_sequence INTEGER NULL AFTER scoring_cycle,
    ADD UNIQUE INDEX participations_person_sequence_key (person_id,scoring_sequence),
    ADD CONSTRAINT participations_sequence_check CHECK (scoring_sequence IS NULL OR scoring_sequence > 0);
ALTER TABLE score_transactions
    ADD COLUMN scoring_policy_version_id CHAR(36) NULL AFTER scoring_rule_id,
    ADD COLUMN scoring_engine_version ENUM('V1','V2') NULL AFTER scoring_policy_version_id,
    ADD COLUMN calculation_snapshot JSON NULL AFTER rule_version_snapshot,
    ADD INDEX score_transactions_policy_version_idx (scoring_policy_version_id),
    ADD CONSTRAINT score_transactions_policy_version_fk FOREIGN KEY (scoring_policy_version_id) REFERENCES scoring_policy_versions(id) ON DELETE RESTRICT ON UPDATE CASCADE;
UPDATE score_transactions st
LEFT JOIN score_transactions original ON original.id=st.original_transaction_id
SET st.scoring_engine_version='V1'
WHERE st.scoring_engine_version IS NULL
  AND (
    (st.transaction_type='AWARD'
      AND st.source='SCORING_ENGINE'
      AND st.scoring_rule_id IS NOT NULL)
    OR
    (st.transaction_type='REVERSAL'
      AND original.transaction_type='AWARD'
      AND original.source='SCORING_ENGINE'
      AND original.scoring_rule_id IS NOT NULL)
  );

INSERT IGNORE INTO event_levels (id,code,name,description,active,sort_order,created_at,updated_at) VALUES
('20000000-0000-4000-8000-000000000007','DEPARTMENT','На отделениях',NULL,true,5,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
INSERT IGNORE INTO participation_roles (id,code,name,description,active,built_in,sort_order,created_at,updated_at) VALUES
('30000000-0000-4000-8000-000000000008','SPECTATOR','Зритель',NULL,true,true,15,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
('30000000-0000-4000-8000-000000000009','CO_ORGANIZER','Соорганизатор',NULL,true,true,35,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
('30000000-0000-4000-8000-000000000010','COORDINATOR','Координатор',NULL,true,true,45,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
INSERT IGNORE INTO participation_results (id,code,name,description,active,built_in,sort_order,created_at,updated_at) VALUES
('40000000-0000-4000-8000-000000000007','DIPLOMANT','Дипломант',NULL,true,true,70,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
('40000000-0000-4000-8000-000000000008','ACKNOWLEDGEMENT','Благодарность',NULL,true,true,80,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
('40000000-0000-4000-8000-000000000009','LAUREATE_III','Лауреат III степени',NULL,true,true,90,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
('40000000-0000-4000-8000-000000000010','LAUREATE_II','Лауреат II степени',NULL,true,true,100,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
('40000000-0000-4000-8000-000000000011','LAUREATE_I','Лауреат I степени',NULL,true,true,110,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
('40000000-0000-4000-8000-000000000012','GRAND_PRIX','Гран-при',NULL,true,true,120,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3)),
('40000000-0000-4000-8000-000000000013','ABSOLUTE_WINNER','Абсолютный победитель',NULL,true,true,130,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
INSERT INTO person_status_types (id,code,name,active,created_at,updated_at) VALUES
('62000000-0000-4000-8000-000000000001','PROFESSION_AMBASSADOR','Амбассадор профессии',true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
INSERT INTO scoring_policies (id,organization_id,code,name,active,created_at,updated_at) VALUES
('60000000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000001','KAIT20_DEFAULT','MosActive КАИТ №20',true,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
INSERT INTO scoring_policy_versions (id,scoring_policy_id,version,status,created_at) VALUES
('61000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',1,'DRAFT',UTC_TIMESTAMP(3));
INSERT INTO scoring_policy_role_bases VALUES
('61000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',0.5000),
('61000000-0000-4000-8000-000000000001',(SELECT id FROM participation_roles WHERE code='SPECTATOR'),0.5000),
('61000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',1.0000),
('61000000-0000-4000-8000-000000000001',(SELECT id FROM participation_roles WHERE code='CO_ORGANIZER'),2.0000),
('61000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004',3.0000),
('61000000-0000-4000-8000-000000000001',(SELECT id FROM participation_roles WHERE code='COORDINATOR'),5.0000);
INSERT INTO scoring_policy_level_multipliers VALUES
('61000000-0000-4000-8000-000000000001',(SELECT id FROM event_levels WHERE code='DEPARTMENT'),0.5000),
('61000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1.0000),
('61000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000003',2.0000),
('61000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',3.0000),
('61000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000005',5.0000);
INSERT INTO scoring_policy_status_multipliers VALUES ('61000000-0000-4000-8000-000000000001','62000000-0000-4000-8000-000000000001',1.5000);
INSERT INTO scoring_policy_newcomer_tiers VALUES
('61000000-0000-4000-8000-000000000001',1,1,1.5000),('61000000-0000-4000-8000-000000000001',2,2,1.3000),
('61000000-0000-4000-8000-000000000001',3,3,1.2000),('61000000-0000-4000-8000-000000000001',4,NULL,1.0000);
INSERT INTO scoring_policy_result_bonuses VALUES
('61000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004',2.0000),
('61000000-0000-4000-8000-000000000001',(SELECT id FROM participation_results WHERE code='DIPLOMANT'),2.0000),
('61000000-0000-4000-8000-000000000001',(SELECT id FROM participation_results WHERE code='ACKNOWLEDGEMENT'),2.0000),
('61000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000003',3.0000),
('61000000-0000-4000-8000-000000000001',(SELECT id FROM participation_results WHERE code='LAUREATE_III'),3.0000),
('61000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000002',4.0000),
('61000000-0000-4000-8000-000000000001',(SELECT id FROM participation_results WHERE code='LAUREATE_II'),4.0000),
('61000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',5.0000),
('61000000-0000-4000-8000-000000000001',(SELECT id FROM participation_results WHERE code='LAUREATE_I'),5.0000),
('61000000-0000-4000-8000-000000000001',(SELECT id FROM participation_results WHERE code='GRAND_PRIX'),10.0000),
('61000000-0000-4000-8000-000000000001',(SELECT id FROM participation_results WHERE code='ABSOLUTE_WINNER'),10.0000);
