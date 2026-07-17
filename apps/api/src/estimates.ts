import type { Database } from 'better-sqlite3';
import { computeCellWrites, type PerWriteTime } from '@kanjiscribe/shared';

import { fetchStudyItemKanji, KANA_MS_PER_WRITE, type StudyItemKanji } from './attribution.js';

/**
 * Floor per-stroke handwriting time used when no kanji have been drilled
 * anywhere (Level-4 estimate). Fixed at 0.5 s/stroke per ADR-0005.
 */
export const FLOOR_MS_PER_STROKE = 500;

type AssignmentEstimateRow = {
  status: 'pending' | 'completed' | 'skipped' | 'archived';
  time_spent_ms: number | null;
  surface_form: string;
  selected_reading: string;
  times_completed: number;
  avg_completion_time_ms: number;
  study_item_id: number;
};

type KanjiTimingRow = {
  kanji_literal: string;
  mean_per_write_time_ms: number;
};

type StrokeBucketRow = {
  stroke_count: number;
  mean_per_write_time_ms: number;
};

type GlobalSlopeRow = {
  ms_per_stroke: number | null;
};

type ResolvedKanji = {
  position: number;
  literal: string;
  stroke_count: number;
  per_write_time_ms: number;
};

/**
 * Estimate the remaining drilling time for a single assignment in milliseconds.
 *
 * - Archived assignments contribute 0 ms.
 * - Completed assignments return their actual `time_spent_ms`.
 * - Pending/skipped assignments for previously-drilled study items return
 *   `avg_completion_time_ms` from `v_study_item_stats`.
 * - Pending/skipped assignments for never-drilled study items use the 4-level
 *   per-kanji fallback chain plus the kana-unit rule.
 */
export function estimateAssignment(db: Database, assignmentId: number): number {
  const row = db
    .prepare(
      `
      SELECT
        da.status,
        da.time_spent_ms,
        si.id AS study_item_id,
        si.surface_form,
        si.selected_reading,
        COALESCE(vsis.times_completed, 0) AS times_completed,
        COALESCE(vsis.avg_completion_time_ms, 0) AS avg_completion_time_ms
      FROM daily_assignment da
      JOIN study_item si ON si.id = da.study_item_id
      LEFT JOIN v_study_item_stats vsis ON vsis.study_item_id = da.study_item_id
      WHERE da.id = ?
      `
    )
    .get(assignmentId) as AssignmentEstimateRow | undefined;

  if (!row) {
    return 0;
  }

  if (row.status === 'archived') {
    return 0;
  }

  if (row.status === 'completed') {
    return row.time_spent_ms ?? 0;
  }

  if (row.times_completed >= 1) {
    return row.avg_completion_time_ms;
  }

  return estimateNeverDrilledWord(
    db,
    row.study_item_id,
    row.surface_form,
    row.selected_reading
  );
}

function estimateNeverDrilledWord(
  db: Database,
  studyItemId: number,
  surfaceForm: string,
  selectedReading: string
): number {
  const kanji = fetchStudyItemKanji(db, studyItemId);

  // Resolve the per-write time for every kanji via the full fallback chain
  // first, so the cell model can use the best-known times for remainder-cell
  // tie-breaking as well as for the final estimate.
  const resolved = resolveKanjiPerWriteTimes(db, kanji);

  const perWriteTimes: PerWriteTime[] = resolved.map((k) => ({
    position: k.position,
    per_write_time_ms: k.per_write_time_ms
  }));

  const cellResult = computeCellWrites(
    surfaceForm,
    kanji.map((k) => ({ position: k.position, stroke_count: k.stroke_count })),
    selectedReading,
    perWriteTimes
  );

  let kanjiEstimateMs = 0;
  for (const k of resolved) {
    const writesCount = cellResult.per_char_writes.get(k.position) ?? 0;
    if (writesCount === 0) {
      continue;
    }
    kanjiEstimateMs += k.per_write_time_ms * writesCount;
  }

  return kanjiEstimateMs + cellResult.kana_writes_total * KANA_MS_PER_WRITE;
}

function resolveKanjiPerWriteTimes(db: Database, kanji: StudyItemKanji[]): ResolvedKanji[] {
  const kanjiTimingRows = db
    .prepare(`SELECT kanji_literal, mean_per_write_time_ms FROM v_kanji_timing`)
    .all() as KanjiTimingRow[];
  const strokeBucketRows = db
    .prepare(`SELECT stroke_count, mean_per_write_time_ms FROM v_stroke_count_bucket`)
    .all() as StrokeBucketRow[];
  const globalSlopeRow = db
    .prepare(`SELECT ms_per_stroke FROM v_kanji_global_slope`)
    .get() as GlobalSlopeRow | undefined;

  const kanjiTiming = new Map(
    kanjiTimingRows.map((r) => [r.kanji_literal, r.mean_per_write_time_ms])
  );
  const strokeBucket = new Map(
    strokeBucketRows.map((r) => [r.stroke_count, r.mean_per_write_time_ms])
  );
  const globalSlope = globalSlopeRow?.ms_per_stroke ?? null;

  return kanji.map((k) => {
    let perWriteTimeMs: number;
    if (kanjiTiming.has(k.literal)) {
      // Level 1: per-kanji mean per-write time.
      perWriteTimeMs = kanjiTiming.get(k.literal)!;
    } else if (strokeBucket.has(k.stroke_count)) {
      // Level 2: same-stroke-count bucket mean per-write time.
      perWriteTimeMs = strokeBucket.get(k.stroke_count)!;
    } else if (globalSlope !== null) {
      // Level 3: global per-stroke ratio applied to this kanji's stroke count.
      perWriteTimeMs = globalSlope * k.stroke_count;
    } else {
      // Level 4 (floor): fixed per-stroke constant.
      perWriteTimeMs = FLOOR_MS_PER_STROKE * k.stroke_count;
    }

    return {
      position: k.position,
      literal: k.literal,
      stroke_count: k.stroke_count,
      per_write_time_ms: perWriteTimeMs
    };
  });
}
