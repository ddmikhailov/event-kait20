import { z } from 'zod';

import { emailSchema, passwordSchema } from './common.js';

export const staffRoleSchema = z.enum(['SUPER_ADMIN', 'SCANNER']);
export type StaffRoleContract = z.infer<typeof staffRoleSchema>;

export const loginRequestSchema = z
  .object({ email: emailSchema, password: z.string().min(1).max(128) })
  .strict();
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const passwordForgotRequestSchema = z
  .object({ email: emailSchema })
  .strict();
export type PasswordForgotRequest = z.infer<typeof passwordForgotRequestSchema>;

export const passwordResetRequestSchema = z
  .object({ token: z.string().min(20).max(500), password: passwordSchema })
  .strict();
export type PasswordResetRequest = z.infer<typeof passwordResetRequestSchema>;

export const invitationAcceptRequestSchema = z
  .object({ password: passwordSchema })
  .strict();
export type InvitationAcceptRequest = z.infer<
  typeof invitationAcceptRequestSchema
>;

export const sessionUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: staffRoleSchema,
});

export const sessionResponseSchema = z.object({
  authenticated: z.literal(true),
  csrfToken: z.string().min(20),
  expiresAt: z.iso.datetime({ offset: true }),
  user: sessionUserSchema,
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
