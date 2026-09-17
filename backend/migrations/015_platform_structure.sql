-- Add the shared multi-tenant platform structure without rewriting business history.
CREATE TABLE tenants (
    id CHAR(36) NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX tenants_code_key (code)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE organizations (
    id CHAR(36) NOT NULL,
    tenant_id CHAR(36) NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    short_name VARCHAR(100) NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX organizations_tenant_code_key (tenant_id, code),
    UNIQUE INDEX organizations_id_tenant_key (id, tenant_id),
    CONSTRAINT organizations_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE departments (
    id CHAR(36) NOT NULL,
    organization_id CHAR(36) NOT NULL,
    code VARCHAR(50) NOT NULL,
    name VARCHAR(150) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX departments_organization_code_key (organization_id, code),
    UNIQUE INDEX departments_id_organization_key (id, organization_id),
    INDEX departments_organization_active_idx (organization_id, active, sort_order),
    CONSTRAINT departments_sort_check CHECK (sort_order >= 0),
    CONSTRAINT departments_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE study_groups (
    id CHAR(36) NOT NULL,
    organization_id CHAR(36) NOT NULL,
    department_id CHAR(36) NULL,
    name VARCHAR(100) NOT NULL,
    code VARCHAR(50) NULL,
    course TINYINT NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX study_groups_organization_code_key (organization_id, code),
    UNIQUE INDEX study_groups_org_department_name_key (organization_id, department_id, name),
    UNIQUE INDEX study_groups_id_organization_key (id, organization_id),
    INDEX study_groups_department_course_idx (department_id, course, active),
    CONSTRAINT study_groups_course_check CHECK (course IS NULL OR course BETWEEN 1 AND 4),
    CONSTRAINT study_groups_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT study_groups_department_organization_fk FOREIGN KEY (department_id, organization_id) REFERENCES departments(id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE activity_directions (
    id CHAR(36) NOT NULL,
    tenant_id CHAR(36) NOT NULL,
    organization_id CHAR(36) NULL,
    code VARCHAR(50) NOT NULL,
    scope_code_key VARCHAR(124) GENERATED ALWAYS AS (
        CONCAT(tenant_id, ':', COALESCE(organization_id, 'GLOBAL'), ':', code)
    ) STORED,
    name VARCHAR(150) NOT NULL,
    scope_name_key VARCHAR(224) GENERATED ALWAYS AS (
        CONCAT(tenant_id, ':', COALESCE(organization_id, 'GLOBAL'), ':', name)
    ) STORED,
    description VARCHAR(500) NULL,
    active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (id),
    UNIQUE INDEX activity_directions_scope_code_key (scope_code_key),
    UNIQUE INDEX activity_directions_scope_name_key (scope_name_key),
    INDEX activity_directions_organization_tenant_idx (organization_id, tenant_id),
    INDEX activity_directions_scope_active_idx (tenant_id, organization_id, active, sort_order),
    CONSTRAINT activity_directions_sort_check CHECK (sort_order >= 0),
    CONSTRAINT activity_directions_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
    CONSTRAINT activity_directions_organization_tenant_fk FOREIGN KEY (organization_id, tenant_id) REFERENCES organizations(id, tenant_id) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO tenants (id, code, name, active, created_at, updated_at)
VALUES ('50000000-0000-4000-8000-000000000001', 'kait20', 'КАИТ №20', true, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT INTO organizations (id, tenant_id, code, name, short_name, active, created_at, updated_at)
VALUES ('51000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 'kait20', 'КАИТ №20', 'КАИТ №20', true, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

INSERT INTO departments (id, organization_id, code, name, active, sort_order, created_at, updated_at) VALUES
    ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'DATA_HUB', 'Датахаб', true, 10, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('52000000-0000-4000-8000-000000000002', '51000000-0000-4000-8000-000000000001', 'TECHNO', 'Техно', true, 20, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('52000000-0000-4000-8000-000000000003', '51000000-0000-4000-8000-000000000001', 'ARTECH', 'АртТех', true, 30, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('52000000-0000-4000-8000-000000000004', '51000000-0000-4000-8000-000000000001', 'CYBER', 'Кибер', true, 40, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('52000000-0000-4000-8000-000000000005', '51000000-0000-4000-8000-000000000001', 'MOSSOVET', 'МосСовет', true, 50, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
    ('52000000-0000-4000-8000-000000000006', '51000000-0000-4000-8000-000000000001', 'DIGITAL', 'Диджитал', true, 60, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3));

-- Controlled KAIT20 aliases only. utf8mb4_unicode_ci makes matching case-insensitive,
-- so one Моссовет row also covers the МосСовет case variant.
CREATE TEMPORARY TABLE kait20_department_aliases (
    alias_name VARCHAR(150) NOT NULL,
    canonical_code VARCHAR(50) NOT NULL,
    PRIMARY KEY (alias_name)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO kait20_department_aliases (alias_name, canonical_code) VALUES
    ('Data Hub', 'DATA_HUB'),
    ('Датахаб', 'DATA_HUB'),
    ('Артех', 'ARTECH'),
    ('АртТех', 'ARTECH'),
    ('Моссовет', 'MOSSOVET'),
    ('Digital', 'DIGITAL'),
    ('Диджитал', 'DIGITAL'),
    ('Техно', 'TECHNO'),
    ('Кибер', 'CYBER');

ALTER TABLE persons ADD COLUMN tenant_id CHAR(36) NULL AFTER id;
ALTER TABLE staff_users
    ADD COLUMN tenant_id CHAR(36) NULL AFTER id,
    ADD COLUMN organization_id CHAR(36) NULL AFTER tenant_id;
ALTER TABLE staff_invitations
    ADD COLUMN tenant_id CHAR(36) NULL AFTER id,
    ADD COLUMN organization_id CHAR(36) NULL AFTER tenant_id;
ALTER TABLE events
    ADD COLUMN organization_id CHAR(36) NULL AFTER id,
    ADD COLUMN direction_id CHAR(36) NULL AFTER direction;
ALTER TABLE student_memberships
    ADD COLUMN organization_id CHAR(36) NULL AFTER person_id,
    ADD COLUMN department_id CHAR(36) NULL AFTER organization_id,
    ADD COLUMN study_group_id CHAR(36) NULL AFTER department_id,
    ADD COLUMN course TINYINT NULL AFTER study_group_id;

UPDATE persons SET tenant_id='50000000-0000-4000-8000-000000000001' WHERE tenant_id IS NULL;
UPDATE staff_users SET tenant_id='50000000-0000-4000-8000-000000000001', organization_id='51000000-0000-4000-8000-000000000001' WHERE tenant_id IS NULL OR organization_id IS NULL;
UPDATE staff_invitations SET tenant_id='50000000-0000-4000-8000-000000000001', organization_id='51000000-0000-4000-8000-000000000001' WHERE tenant_id IS NULL OR organization_id IS NULL;
UPDATE events SET organization_id='51000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;
UPDATE student_memberships SET organization_id='51000000-0000-4000-8000-000000000001' WHERE organization_id IS NULL;

INSERT INTO departments (id, organization_id, code, name, active, sort_order, created_at, updated_at)
SELECT UUID(), '51000000-0000-4000-8000-000000000001', CONCAT('LEGACY_', UPPER(LEFT(SHA2(TRIM(legacy.department),256),16))), TRIM(legacy.department), true, 1000, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM (SELECT DISTINCT department FROM student_memberships WHERE department IS NOT NULL AND TRIM(department)<>'') legacy
LEFT JOIN kait20_department_aliases alias ON alias.alias_name=TRIM(legacy.department)
WHERE alias.alias_name IS NULL
  AND NOT EXISTS (SELECT 1 FROM departments d WHERE d.organization_id='51000000-0000-4000-8000-000000000001' AND d.name=TRIM(legacy.department));

INSERT INTO study_groups (id, organization_id, department_id, name, code, course, active, created_at, updated_at)
SELECT UUID(), '51000000-0000-4000-8000-000000000001', normalized.department_id, normalized.study_group, NULL, NULL, true, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM (
    SELECT DISTINCT TRIM(sm.study_group) AS study_group, d.id AS department_id
    FROM student_memberships sm
    LEFT JOIN kait20_department_aliases alias ON alias.alias_name=TRIM(sm.department)
    JOIN departments d ON d.organization_id='51000000-0000-4000-8000-000000000001'
      AND ((alias.canonical_code IS NOT NULL AND d.code=alias.canonical_code)
        OR (alias.canonical_code IS NULL AND d.name=TRIM(sm.department)))
    WHERE sm.study_group IS NOT NULL AND TRIM(sm.study_group)<>''
      AND sm.department IS NOT NULL AND TRIM(sm.department)<>''
) normalized;

UPDATE student_memberships sm
LEFT JOIN kait20_department_aliases alias ON alias.alias_name=TRIM(sm.department)
LEFT JOIN departments d ON d.organization_id=sm.organization_id
  AND ((alias.canonical_code IS NOT NULL AND d.code=alias.canonical_code)
    OR (alias.canonical_code IS NULL AND d.name=TRIM(sm.department)))
LEFT JOIN study_groups sg ON sg.organization_id=sm.organization_id AND sg.department_id=d.id AND sg.name=TRIM(sm.study_group)
SET sm.department_id=d.id, sm.study_group_id=sg.id;

DROP TEMPORARY TABLE kait20_department_aliases;

INSERT INTO activity_directions (id, tenant_id, organization_id, code, name, description, active, sort_order, created_at, updated_at)
SELECT UUID(), '50000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', CONCAT('LEGACY_', UPPER(LEFT(SHA2(TRIM(legacy.direction),256),16))), TRIM(legacy.direction), NULL, true, 1000, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM (SELECT DISTINCT TRIM(direction) AS direction FROM events WHERE direction IS NOT NULL AND TRIM(direction)<>'') legacy;

UPDATE events e
JOIN activity_directions ad ON ad.tenant_id='50000000-0000-4000-8000-000000000001' AND ad.organization_id=e.organization_id AND ad.name=TRIM(e.direction)
SET e.direction_id=ad.id
WHERE e.direction IS NOT NULL AND TRIM(e.direction)<>'';

ALTER TABLE persons
    MODIFY tenant_id CHAR(36) NOT NULL,
    ADD INDEX persons_tenant_email_idx (tenant_id, email_normalized),
    ADD INDEX persons_tenant_phone_idx (tenant_id, phone_normalized),
    ADD INDEX persons_tenant_name_idx (tenant_id, last_name, first_name, middle_name),
    ADD CONSTRAINT persons_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE staff_users
    MODIFY tenant_id CHAR(36) NOT NULL,
    MODIFY organization_id CHAR(36) NOT NULL,
    ADD INDEX staff_users_tenant_idx (tenant_id, active),
    ADD CONSTRAINT staff_users_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT staff_users_organization_tenant_fk FOREIGN KEY (organization_id, tenant_id) REFERENCES organizations(id, tenant_id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE staff_invitations
    MODIFY tenant_id CHAR(36) NOT NULL,
    MODIFY organization_id CHAR(36) NOT NULL,
    ADD INDEX staff_invitations_tenant_idx (tenant_id, email_normalized),
    ADD CONSTRAINT staff_invitations_tenant_fk FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT staff_invitations_organization_tenant_fk FOREIGN KEY (organization_id, tenant_id) REFERENCES organizations(id, tenant_id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE events
    MODIFY organization_id CHAR(36) NOT NULL,
    ADD INDEX events_organization_status_idx (organization_id, status, start_at),
    ADD INDEX events_direction_idx (direction_id),
    ADD CONSTRAINT events_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT events_direction_fk FOREIGN KEY (direction_id) REFERENCES activity_directions(id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE student_memberships
    MODIFY organization_id CHAR(36) NOT NULL,
    ADD INDEX student_memberships_group_snapshot_idx (study_group_id, course, valid_from, valid_to),
    ADD INDEX student_memberships_department_snapshot_idx (department_id, course, valid_from, valid_to),
    ADD CONSTRAINT student_memberships_course_check CHECK (course IS NULL OR course BETWEEN 1 AND 4),
    ADD CONSTRAINT student_memberships_organization_fk FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT student_memberships_department_organization_fk FOREIGN KEY (department_id, organization_id) REFERENCES departments(id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT student_memberships_group_organization_fk FOREIGN KEY (study_group_id, organization_id) REFERENCES study_groups(id, organization_id) ON DELETE RESTRICT ON UPDATE CASCADE;
