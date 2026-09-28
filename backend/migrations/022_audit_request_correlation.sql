-- Keep administrative audit entries linkable to the server's request ID.
-- Historical entries remain readable with request_id=NULL.
ALTER TABLE audit_log ADD COLUMN request_id VARCHAR(64) NULL;
CREATE INDEX audit_log_request_id_idx ON audit_log (request_id);
