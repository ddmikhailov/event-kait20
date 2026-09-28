import { z } from 'zod';

import { uuidSchema } from './common.js';

export const auditEntrySchema = z.object({
  id: uuidSchema,
  action: z.string().min(1).max(255),
  entityType: z.string().min(1).max(255),
  entityId: z.string().nullable(),
  requestId: z.string().max(64).nullable(),
  actorEmail: z.email(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const auditListSchema = z.object({
  page: z.number().int().min(1),
  hasNext: z.boolean(),
  items: z.array(auditEntrySchema).max(25),
});

export type AuditList = z.infer<typeof auditListSchema>;
