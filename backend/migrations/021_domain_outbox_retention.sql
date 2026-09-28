-- domain_outbox is a bounded internal diagnostic journal, not a delivery queue.
-- Business history remains in participations, score_transactions and audit_log.
ALTER TABLE domain_outbox
    ADD INDEX domain_outbox_retention_idx (occurred_at);
