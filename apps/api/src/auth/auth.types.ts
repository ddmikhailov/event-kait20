import type { StaffRoleContract } from '@event-registration/contracts';
import type { Request } from 'express';

export type AuthenticatedStaff = {
  id: string;
  email: string;
  role: StaffRoleContract;
};

export type StaffRequest = Request & {
  auth: {
    csrfToken: string;
    expiresAt: Date;
    rawSessionToken: string;
    sessionId: string;
    user: AuthenticatedStaff;
  };
};
