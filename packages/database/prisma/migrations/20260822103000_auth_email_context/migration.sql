-- Durable references let the future email worker reconstruct signed auth links
-- from record id, purpose and expiry without storing raw token material.
ALTER TABLE "email_deliveries"
  ADD COLUMN "staff_invitation_id" UUID,
  ADD COLUMN "password_reset_token_id" UUID;

ALTER TABLE "email_deliveries"
  ADD CONSTRAINT "email_deliveries_auth_link_record_check"
  CHECK (num_nonnulls("staff_invitation_id", "password_reset_token_id") <= 1);

ALTER TABLE "email_deliveries"
  ADD CONSTRAINT "email_deliveries_staff_invitation_id_fkey"
  FOREIGN KEY ("staff_invitation_id") REFERENCES "staff_invitations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "email_deliveries_password_reset_token_id_fkey"
  FOREIGN KEY ("password_reset_token_id") REFERENCES "password_reset_tokens"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "email_deliveries_staff_invitation_id_idx"
  ON "email_deliveries"("staff_invitation_id");

CREATE INDEX "email_deliveries_password_reset_token_id_idx"
  ON "email_deliveries"("password_reset_token_id");
