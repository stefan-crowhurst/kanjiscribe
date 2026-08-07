import { z } from 'zod';

import {
  assignmentOriginSchema,
  assignmentStatusSchema,
  dateSchema,
  sourceTypeSchema,
  timestampSchema
} from '../schemas.js';

/**
 * Intake response — the success body of `POST /study-items/intake`, covering
 * both success shapes: 201 (fresh assignment) and 200 (re-adding a
 * previously-removed word, which unarchives the existing assignment). The
 * bodies are identical; they differ only in the status code and in
 * `study_item.is_new`.
 */
export const intakeResponseSchema = z.object({
  study_item: z.object({
    id: z.number(),
    surface_form: z.string(),
    selected_reading: z.string(),
    dictionary_entry_id: z.number(),
    source_type: sourceTypeSchema,
    created_at: timestampSchema,
    is_new: z.boolean()
  }),
  assignment: z.object({
    id: z.number(),
    study_item_id: z.number(),
    assigned_for_date: dateSchema,
    status: assignmentStatusSchema,
    origin: assignmentOriginSchema,
    created_at: timestampSchema
  })
});

export type IntakeResponse = z.infer<typeof intakeResponseSchema>;
