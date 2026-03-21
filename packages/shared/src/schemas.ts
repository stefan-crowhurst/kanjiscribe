import { z } from 'zod';

import { ASSIGNMENT_ORIGINS, ASSIGNMENT_STATUSES, EVENT_TYPES, SOURCE_TYPES } from './enums.js';

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const timestampSchema = z.string().datetime({ offset: true });

export const assignmentStatusSchema = z.enum(ASSIGNMENT_STATUSES);
export const assignmentOriginSchema = z.enum(ASSIGNMENT_ORIGINS);
export const sourceTypeSchema = z.enum(SOURCE_TYPES);
export const eventTypeSchema = z.enum(EVENT_TYPES);

export const dictionarySearchQuerySchema = z.object({
  q: z.string().trim().min(1)
});

export const intakeRequestSchema = z.object({
  surface_form: z.string().trim().min(1),
  selected_reading: z.string().trim().min(1),
  dictionary_entry_id: z.number().int().positive(),
  source_type: sourceTypeSchema.default('manual'),
  assigned_for_date: dateSchema.optional()
});

export const updateAssignmentTimeSchema = z.object({
  time_spent_ms: z.number().int().min(0).optional()
});

export const assignmentSummarySchema = z.object({
  id: z.number().int().positive(),
  study_item_id: z.number().int().positive(),
  assigned_for_date: dateSchema,
  status: assignmentStatusSchema,
  origin: assignmentOriginSchema,
  time_spent_ms: z.number().int().nullable(),
  created_at: timestampSchema,
  completed_at: timestampSchema.nullable()
});

export const assignmentsQuerySchema = z.object({
  status: assignmentStatusSchema.optional(),
  date: dateSchema.optional()
});

export const queueSourceSchema = z.enum(['today', 'backlog']).optional();

export type IntakeRequest = z.infer<typeof intakeRequestSchema>;
