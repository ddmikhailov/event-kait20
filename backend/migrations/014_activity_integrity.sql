-- Strengthen Activity history, consent and historical membership attribution.
ALTER TABLE scoring_rules
    DROP INDEX scoring_rules_active_match_key,
    ADD INDEX scoring_rules_match_lookup (active_match_key);

CREATE TEMPORARY TABLE profile_consent_keep (
    person_id CHAR(36) NOT NULL PRIMARY KEY,
    consent_id CHAR(36) NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO profile_consent_keep (person_id, consent_id)
SELECT person_id, id
FROM (
    SELECT person_id, id,
           ROW_NUMBER() OVER (PARTITION BY person_id ORDER BY accepted_at DESC, id DESC) AS position
    FROM profile_publication_consents
    WHERE withdrawn_at IS NULL
) ranked
WHERE position = 1;

UPDATE profile_publication_consents consent
JOIN profile_consent_keep keep_row ON keep_row.person_id = consent.person_id
SET consent.withdrawn_at = UTC_TIMESTAMP(3)
WHERE consent.withdrawn_at IS NULL AND consent.id <> keep_row.consent_id;

DROP TEMPORARY TABLE profile_consent_keep;

ALTER TABLE profile_publication_consents
    ADD COLUMN active_person_id CHAR(36) GENERATED ALWAYS AS (
        CASE WHEN withdrawn_at IS NULL THEN person_id ELSE NULL END
    ) VIRTUAL,
    ADD UNIQUE INDEX profile_consents_single_active_key (active_person_id);

ALTER TABLE score_transactions
    ADD COLUMN membership_id CHAR(36) NULL AFTER season_id,
    ADD INDEX score_transactions_membership_idx (membership_id, season_id),
    ADD CONSTRAINT score_transactions_membership_fk
        FOREIGN KEY (membership_id) REFERENCES student_memberships(id)
        ON DELETE RESTRICT ON UPDATE CASCADE;
