-- R21: worker revalidates email intent immediately before SMTP send. A
-- queued message whose underlying intent is no longer current (superseded
-- or used password reset, accepted/expired invitation, cancelled
-- registration) is a terminal outcome, not a retryable SMTP failure — it
-- needs its own status distinct from FAILED, which still means "SMTP kept
-- rejecting a still-valid message until attempts ran out".
ALTER TABLE email_deliveries
    MODIFY COLUMN status ENUM('QUEUED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED') NOT NULL;
