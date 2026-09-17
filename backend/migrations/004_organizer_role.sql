-- Add the global event-organizer role without rewriting the approved baseline.
ALTER TABLE `staff_users`
    MODIFY `system_role` ENUM('SUPER_ADMIN', 'ORGANIZER', 'SCANNER') NOT NULL;

ALTER TABLE `staff_invitations`
    MODIFY `role` ENUM('SUPER_ADMIN', 'ORGANIZER', 'SCANNER') NOT NULL;
