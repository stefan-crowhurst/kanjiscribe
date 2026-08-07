import { z } from 'zod';

import { DICTIONARY_MATCH_TYPES } from './enums.js';
import {
  assignmentOriginSchema,
  assignmentStatusSchema,
  dateSchema,
  sourceTypeSchema,
  timestampSchema
} from './schemas.js';

/**
 * Response contract schemas (see ADR-0006). The inferred types name the
 * response shapes; the api annotates route returns with them (api-side drift
 * becomes a compile error) and the web's `apiRequest` parses every response
 * through them (web-side drift becomes a runtime rejection).
 */

export const estimatesResponseSchema = z.object({
  estimated_remaining_ms: z.number()
});

export type EstimatesResponse = z.infer<typeof estimatesResponseSchema>;

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

/**
 * Heatmap day — one cell of the dashboard progress heatmap. The superset the
 * api actually returns: every count/time field plus the day verdict
 * (`estimate_delta_ms`) and the day estimate (`estimated_total_ms`). All five
 * hand-declared web shapes (DashboardPage, ProgressCharts, Heatmap, TodayPage,
 * DayDetailPage) collapsed onto this one (issue 13) — the drift where some
 * declarations omitted `estimated_total_ms` is gone.
 */
export const heatmapDaySchema = z.object({
  date: dateSchema,
  total_assignments: z.number(),
  completed_count: z.number(),
  pending_count: z.number(),
  skipped_count: z.number(),
  total_time_ms: z.number(),
  is_fully_completed: z.boolean(),
  estimate_delta_ms: z.number().nullable(),
  estimated_total_ms: z.number().nullable()
});

export type HeatmapDay = z.infer<typeof heatmapDaySchema>;

/**
 * Dashboard response (`GET /stats/dashboard`) — today's counts, the overdue
 * snapshot, lifetime totals, and the heatmap over the requested range.
 */
export const dashboardResponseSchema = z.object({
  today: z.object({
    total: z.number(),
    pending: z.number(),
    completed: z.number(),
    total_time_ms: z.number(),
    avg_time_per_assignment_ms: z.number()
  }),
  overdue: z.object({
    total_pending: z.number(),
    oldest_date: dateSchema.nullable(),
    incomplete_days: z.number()
  }),
  totals: z.object({
    total_time_ms: z.number(),
    total_completed: z.number(),
    avg_time_per_assignment_ms: z.number()
  }),
  heatmap: z.array(heatmapDaySchema)
});

export type DashboardResponse = z.infer<typeof dashboardResponseSchema>;

/**
 * Study-item stats response (`GET /stats/study-items/:id`) — per-word summary
 * counts plus the ten most recent assignments of the study item.
 */
export const studyItemStatsResponseSchema = z.object({
  study_item: z.object({
    id: z.number(),
    surface_form: z.string(),
    selected_reading: z.string()
  }),
  stats: z.object({
    total_assignments: z.number(),
    times_completed: z.number(),
    total_time_ms: z.number(),
    avg_completion_time_ms: z.number(),
    first_assigned: dateSchema.nullable(),
    last_assigned: dateSchema.nullable()
  }),
  recent_assignments: z.array(
    z.object({
      id: z.number(),
      assigned_for_date: dateSchema,
      status: assignmentStatusSchema,
      time_spent_ms: z.number().nullable(),
      completed_at: timestampSchema.nullable()
    })
  )
});

export type StudyItemStatsResponse = z.infer<typeof studyItemStatsResponseSchema>;

/**
 * Kanji stats response (`GET /stats/kanji/:literal`) — the kanji's dictionary
 * profile, drill counts, and the study items that contain it.
 */
export const kanjiStatsResponseSchema = z.object({
  kanji: z.object({
    literal: z.string(),
    meanings: z.array(z.string()),
    onyomi: z.array(z.string()),
    kunyomi: z.array(z.string()),
    stroke_count: z.number(),
    grade: z.number().nullable(),
    jlpt_level: z.number().nullable(),
    frequency_rank: z.number().nullable(),
    stroke_asset_url: z.string().nullable()
  }),
  stats: z.object({
    word_count: z.number(),
    total_assignments: z.number(),
    times_drilled: z.number()
  }),
  study_items: z.array(
    z.object({
      id: z.number(),
      surface_form: z.string(),
      selected_reading: z.string()
    })
  )
});

export type KanjiStatsResponse = z.infer<typeof kanjiStatsResponseSchema>;

const wordRankingSchema = z.object({
  study_item_id: z.number(),
  surface_form: z.string(),
  selected_reading: z.string(),
  times_completed: z.number(),
  total_time_ms: z.number(),
  avg_completion_time_ms: z.number()
});

/**
 * Word leaderboards — `GET /stats/top-words` (most drilled) and
 * `GET /stats/slowest-words` (slowest average completion), both ranked
 * `{ words }` lists of the same row shape.
 */
export const topWordsResponseSchema = z.object({ words: z.array(wordRankingSchema) });

export type TopWordsResponse = z.infer<typeof topWordsResponseSchema>;

export const slowestWordsResponseSchema = z.object({ words: z.array(wordRankingSchema) });

export type SlowestWordsResponse = z.infer<typeof slowestWordsResponseSchema>;

/**
 * Top-kanji response (`GET /stats/top-kanji`) — most drilled kanji with their
 * reading info and drill counts.
 */
export const topKanjiResponseSchema = z.object({
  kanji: z.array(
    z.object({
      literal: z.string(),
      word_count: z.number(),
      total_assignments: z.number(),
      times_drilled: z.number(),
      onyomi: z.array(z.string()),
      kunyomi: z.array(z.string()),
      stroke_count: z.number(),
      grade: z.number().nullable()
    })
  )
});

export type TopKanjiResponse = z.infer<typeof topKanjiResponseSchema>;

/**
 * Dictionary search result — one hit of `GET /dictionary/search`: the entry's
 * primary spelling/reading, the first five glosses, all spellings and
 * readings, the `match_type` tier, and whether a non-archived assignment
 * exists for the entry today (`today_assigned`).
 */
export const dictionarySearchResultSchema = z.object({
  entry_id: z.number(),
  primary_spelling: z.string().nullable(),
  primary_reading: z.string().nullable(),
  glosses: z.array(z.string()),
  is_common: z.boolean(),
  readings: z.array(
    z.object({
      text: z.string(),
      no_kanji: z.boolean()
    })
  ),
  spellings: z.array(
    z.object({
      text: z.string(),
      is_primary: z.boolean()
    })
  ),
  today_assigned: z.boolean(),
  match_type: z.enum(DICTIONARY_MATCH_TYPES)
});

export type DictionarySearchResult = z.infer<typeof dictionarySearchResultSchema>;

export const dictionarySearchResponseSchema = z.object({
  results: z.array(dictionarySearchResultSchema)
});

export type DictionarySearchResponse = z.infer<typeof dictionarySearchResponseSchema>;

/**
 * Dictionary entry detail — the full entry returned by
 * `GET /dictionary/entries/:id`: every spelling/reading with its priority and
 * kanji flags, all senses (glosses, parts of speech, and the tag/notes
 * arrays), and the reading↔spelling restriction pairs.
 */
export const dictionaryEntryDetailSchema = z.object({
  id: z.number(),
  is_common: z.boolean(),
  priority_rank: z.number().nullable(),
  spellings: z.array(
    z.object({
      text: z.string(),
      is_primary: z.boolean(),
      priority_rank: z.number().nullable()
    })
  ),
  readings: z.array(
    z.object({
      text: z.string(),
      is_primary: z.boolean(),
      no_kanji: z.boolean()
    })
  ),
  senses: z.array(
    z.object({
      sense_index: z.number(),
      glosses: z.array(z.string()),
      parts_of_speech: z.array(z.string()),
      misc_tags: z.array(z.string()),
      field_tags: z.array(z.string()),
      dialect_tags: z.array(z.string()),
      info: z.array(z.string())
    })
  ),
  reading_restrictions: z.array(
    z.object({
      reading_text: z.string(),
      spelling_text: z.string()
    })
  )
});

export type DictionaryEntryDetail = z.infer<typeof dictionaryEntryDetailSchema>;

export const dictionaryEntryDetailResponseSchema = z.object({
  entry: dictionaryEntryDetailSchema
});

export type DictionaryEntryDetailResponse = z.infer<typeof dictionaryEntryDetailResponseSchema>;

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
