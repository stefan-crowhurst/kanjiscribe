import { z } from 'zod';

import {
  assignmentOriginSchema,
  assignmentStatusSchema,
  dateSchema,
  timestampSchema
} from '../schemas.js';

/**
 * Assignment summary — the assignment row returned by the five lifecycle
 * routes (complete, skip, reopen, archive, unarchive), wrapped as
 * `{ assignment }`.
 */
export const assignmentSummarySchema = z.object({
  id: z.number(),
  status: assignmentStatusSchema,
  time_spent_ms: z.number().nullable(),
  completed_at: timestampSchema.nullable()
});

export type AssignmentSummary = z.infer<typeof assignmentSummarySchema>;

export const assignmentSummaryResponseSchema = z.object({
  assignment: assignmentSummarySchema
});

export type AssignmentSummaryResponse = z.infer<typeof assignmentSummaryResponseSchema>;

/**
 * Assignment — one row of the list response (`GET /assignments`), shared by
 * the Today, day detail, and backlog surfaces.
 */
export const assignmentSchema = z.object({
  id: z.number(),
  study_item_id: z.number(),
  assigned_for_date: dateSchema,
  status: assignmentStatusSchema,
  origin: assignmentOriginSchema,
  time_spent_ms: z.number().nullable(),
  estimated_ms: z.number().nullable(),
  created_at: timestampSchema,
  completed_at: timestampSchema.nullable(),
  study_item: z.object({
    surface_form: z.string(),
    selected_reading: z.string(),
    first_gloss: z.string().nullable()
  })
});

export type Assignment = z.infer<typeof assignmentSchema>;

export const assignmentListResponseSchema = z.object({
  assignments: z.array(assignmentSchema)
});

export type AssignmentListResponse = z.infer<typeof assignmentListResponseSchema>;

const backlogDayStatsSchema = z.object({
  date: dateSchema,
  total_assignments: z.number(),
  completed_count: z.number(),
  pending_count: z.number()
});

/**
 * Backlog response — unfinished assignments across all days plus per-day
 * summary counts keyed by `assigned_for_date`.
 */
export const backlogResponseSchema = z.object({
  assignments: z.array(assignmentSchema),
  dayStats: z.record(z.string(), backlogDayStatsSchema)
});

export type BacklogResponse = z.infer<typeof backlogResponseSchema>;

const detailStudyItemSchema = z.object({
  id: z.number(),
  surface_form: z.string(),
  selected_reading: z.string()
});

const detailDictionaryEntrySchema = z.object({
  id: z.number(),
  is_common: z.boolean(),
  primary_spelling: z.string(),
  primary_reading: z.string(),
  senses: z.array(
    z.object({
      sense_index: z.number(),
      glosses: z.array(z.string()),
      parts_of_speech: z.array(z.string())
    })
  )
});

const detailKanjiSchema = z.object({
  literal: z.string(),
  position: z.number(),
  meanings: z.array(z.string()),
  onyomi: z.array(z.string()),
  kunyomi: z.array(z.string()),
  stroke_count: z.number(),
  grade: z.number().nullable(),
  jlpt_level: z.number().nullable(),
  frequency_rank: z.number().nullable(),
  stroke_asset_url: z.string().nullable()
});

/**
 * View payload — the shared per-assignment read backing the word-view route.
 * Archived assignments never reach it: both drill and view routes gate
 * archived ids with 409 before this shape is produced.
 */
export const viewPayloadSchema = z.object({
  assignment: z.object({
    id: z.number(),
    assigned_for_date: dateSchema,
    status: assignmentStatusSchema,
    origin: assignmentOriginSchema,
    time_spent_ms: z.number().nullable()
  }),
  study_item: detailStudyItemSchema,
  dictionary_entry: detailDictionaryEntrySchema,
  kanji: z.array(detailKanjiSchema)
});

export type ViewPayload = z.infer<typeof viewPayloadSchema>;

export const drillQueueSchema = z.object({
  current_index: z.number(),
  total: z.number(),
  next_assignment_id: z.number().nullable(),
  prev_assignment_id: z.number().nullable(),
  day_completed_count: z.number(),
  day_total_count: z.number()
});

export type DrillQueue = z.infer<typeof drillQueueSchema>;

/**
 * Drill payload — the view payload plus queue navigation and the day's total
 * recorded time. `assignment.time_spent_ms` is included (issue 08): the web
 * shows the word's recorded time while drilling a completed assignment.
 */
export const drillPayloadSchema = viewPayloadSchema.extend({
  queue: drillQueueSchema,
  day_total_time_ms: z.number()
});

export type DrillPayload = z.infer<typeof drillPayloadSchema>;
