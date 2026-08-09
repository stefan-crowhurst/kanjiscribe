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

export const assignmentsQuerySchema = z.object({
  status: assignmentStatusSchema.optional(),
  date: dateSchema.optional()
});

export const queueSourceSchema = z.enum(['today', 'backlog']).optional();

/**
 * `queue_ids` drill URL param (ADR-0006): a comma-joined list of positive
 * assignment ids, or an array of ids. Junk entries (empty, non-numeric,
 * non-integer, non-positive) are dropped and survivors deduplicated in
 * order, exactly as the drill page's hand-rolled split did — a hand-edited
 * URL degrades gracefully instead of failing. The web's drill and word-view
 * pages parse their `ids` params through this schema before use.
 */
export const queueIdsSchema = z.preprocess(
  (value) => {
    const parts = Array.isArray(value)
      ? value.map(String)
      : typeof value === 'string' && value.trim() !== ''
        ? value.split(',')
        : [];
    const seen = new Set<number>();
    const ids: number[] = [];
    for (const part of parts) {
      const id = Number(part.trim());
      if (Number.isInteger(id) && id > 0 && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
  },
  z.array(z.number().int().positive())
);

/**
 * `queue_label` drill URL param (ADR-0006): a non-empty trimmed label that
 * the drill page echoes into its navigation links and shows above the
 * queue. Absent or junk labels are dropped by the page (optional); the
 * label is client-side only and never sent to the api.
 */
export const queueLabelSchema = z.string().trim().min(1).optional();

/**
 * Word-view URL params (ADR-0006): `day` is the shared date format and
 * `ids` the comma-joined id list behind prev/next navigation; both are
 * optional and each degrades independently — a junk `day` drops to absent
 * (back link falls back) while valid `ids` still drive prev/next, exactly
 * as the page's hand-rolled parsing behaved. The word-view page parses its
 * query string through this schema before building its links.
 */
export const wordViewQuerySchema = z.object({
  day: dateSchema.optional().catch(undefined),
  ids: queueIdsSchema.optional().catch([])
});

/**
 * Path-parameter id (ADR-0006): a numeric string is coerced to a positive
 * integer. Missing, non-numeric, non-integer, and non-positive values are
 * rejected; every id-taking route parses its `:id` param through this schema.
 */
export const pathIdSchema = z.coerce.number().int().positive();

export const dashboardQuerySchema = z.object({
  from: dateSchema.optional(),
  to: dateSchema.optional()
});

/**
 * Environment configuration shared by the api and web apps (ADR-0006):
 * a snapshot of the raw env vars is parsed through this schema at boot,
 * so a malformed value fails fast with the zod message naming the variable.
 * Values without a default are optional here — the apps apply their own
 * deployment-specific defaults (e.g. derived paths) after parsing.
 */
export const envConfigSchema = z.object({
  KANJISCRIBE_API_PORT: z.coerce.number().int().positive().finite().default(3000),
  KANJISCRIBE_API_HOST: z.string().trim().min(1).default('0.0.0.0'),
  KANJISCRIBE_DATA_DIR: z.string().trim().min(1).optional(),
  KANJISCRIBE_DB_PATH: z.string().trim().min(1).optional(),
  KANJI_SVG_DIR: z.string().trim().min(1).optional(),
  VITE_API_BASE: z.string().trim().min(1).optional()
});

/**
 * JSON-column string array — the single parse path for the api's JSON
 * columns (sense glosses, parts of speech, misc/field/dialect tags, info,
 * kanji meanings/onyomi/kunyomi, search-result glosses). A `null` payload
 * (e.g. the first-gloss subquery of an entry with no senses) is an empty
 * list; anything else must be valid JSON holding an array of strings.
 * Corrupt payloads throw instead of silently yielding `[]` — the api's
 * route layer turns the throw into a 500 with a logged error, so corruption
 * is discoverable rather than invisible.
 */
export const stringArraySchema = z.preprocess(
  (value) => {
    if (value === null) {
      return [];
    }
    if (typeof value !== 'string') {
      throw new TypeError(`JSON column must be a string, got ${typeof value}`);
    }
    try {
      return JSON.parse(value);
    } catch {
      throw new SyntaxError(`Invalid JSON in column: ${value.slice(0, 120)}`);
    }
  },
  z.array(z.string())
);

/**
 * True when `char` is exactly one kanji character: a single code point in
 * the CJK Unified Ideographs (U+4E00–U+9FFF) or Extension-A (U+3400–U+4DBF)
 * ranges. This is the shared kanji predicate — the intake flow and the
 * kanji-literal path-param schema both run through it, so the two validators
 * cannot disagree about what counts as a kanji character.
 */
export function isKanjiChar(char: string): boolean {
  const codePoint = char.codePointAt(0);
  if (!codePoint) {
    return false;
  }
  return (codePoint >= 0x4e00 && codePoint <= 0x9fff) || (codePoint >= 0x3400 && codePoint <= 0x4dbf);
}

/**
 * Kanji-literal path param (ADR-0006): exactly one character in the CJK
 * Unified Ideographs or Extension-A ranges — the same range the intake
 * flow's kanji check uses. The `/stats/kanji/:literal` route percent-decodes
 * then parses through this schema; empty, multi-character, and non-kanji
 * literals are rejected before any database work.
 */
export const kanjiLiteralSchema = z
  .string()
  .refine((value) => Array.from(value).length === 1, 'Kanji literal must be exactly one character')
  .refine((value) => isKanjiChar(value), 'Kanji literal must be a single kanji character');

export type IntakeRequest = z.infer<typeof intakeRequestSchema>;
