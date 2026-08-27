-- A bootstrap invitation has no existing staff inviter by design.
ALTER TABLE `staff_invitations` MODIFY `invited_by` CHAR(36) NULL;
