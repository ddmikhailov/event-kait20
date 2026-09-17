import { z } from 'zod';

import { uuidSchema } from './common.js';

export const structureCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z][A-Z0-9_]{1,49}$/);

export const organizationReferenceSchema = z
  .object({
    id: uuidSchema,
    code: z.string(),
    name: z.string(),
    shortName: z.string().nullable(),
  })
  .strict();
export type OrganizationReference = z.infer<typeof organizationReferenceSchema>;

export const departmentSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    code: structureCodeSchema,
    name: z.string().min(1).max(150),
    active: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();
export const departmentListSchema = z
  .object({ items: z.array(departmentSchema) })
  .strict();
export const departmentValuesSchema = departmentSchema
  .omit({ id: true, organizationId: true })
  .extend({ organizationId: uuidSchema.optional() });
export const departmentUpdateSchema = departmentValuesSchema
  .omit({ organizationId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export type Department = z.infer<typeof departmentSchema>;
export type DepartmentValues = z.infer<typeof departmentValuesSchema>;
export type DepartmentUpdate = z.infer<typeof departmentUpdateSchema>;

export const studyGroupSchema = z
  .object({
    id: uuidSchema,
    organizationId: uuidSchema,
    department: departmentSchema,
    name: z.string().min(1).max(100),
    code: structureCodeSchema.nullable(),
    course: z.number().int().min(1).max(4).nullable(),
    active: z.boolean(),
  })
  .strict();
export const studyGroupListSchema = z
  .object({ items: z.array(studyGroupSchema) })
  .strict();
export const studyGroupValuesSchema = z
  .object({
    organizationId: uuidSchema.optional(),
    departmentId: uuidSchema,
    name: z.string().trim().min(1).max(100),
    code: structureCodeSchema.nullable().default(null),
    course: z.number().int().min(1).max(4),
    active: z.boolean().default(true),
  })
  .strict();
export const studyGroupUpdateSchema = studyGroupValuesSchema
  .omit({ organizationId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export type StudyGroup = z.infer<typeof studyGroupSchema>;
export type StudyGroupValues = z.infer<typeof studyGroupValuesSchema>;
export type StudyGroupUpdate = z.infer<typeof studyGroupUpdateSchema>;

export const activityDirectionSchema = z
  .object({
    id: uuidSchema,
    tenantId: uuidSchema,
    organizationId: uuidSchema.nullable(),
    code: structureCodeSchema,
    name: z.string().min(1).max(150),
    description: z.string().max(500).nullable(),
    active: z.boolean(),
    sortOrder: z.number().int().nonnegative(),
  })
  .strict();
export const activityDirectionListSchema = z
  .object({ items: z.array(activityDirectionSchema) })
  .strict();
export const activityDirectionValuesSchema = activityDirectionSchema
  .omit({ id: true, tenantId: true })
  .extend({ organizationId: uuidSchema.nullable().optional() });
export const activityDirectionUpdateSchema = activityDirectionValuesSchema
  .omit({ organizationId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export type ActivityDirection = z.infer<typeof activityDirectionSchema>;
export type ActivityDirectionValues = z.infer<
  typeof activityDirectionValuesSchema
>;
export type ActivityDirectionUpdate = z.infer<
  typeof activityDirectionUpdateSchema
>;
