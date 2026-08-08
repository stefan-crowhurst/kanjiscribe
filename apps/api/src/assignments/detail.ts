import type { AssignmentOrigin, AssignmentStatus, ViewPayload } from '@kanjiscribe/shared';
import type { Database } from 'better-sqlite3';

import { getEntryDetails } from '../dictionary/entries.js';
import { safeJsonParse } from '../util.js';

export type AssignmentDetailResult =
  | { kind: 'ok'; payload: ViewPayload }
  | { kind: 'not_found'; message: string };

/**
 * The shared per-assignment read backing the drill and word-view routes: the
 * assignment row, its study item, a dictionary-entry summary, and kanji
 * panels with stroke-asset URLs. Archive policy is not this module's
 * concern — routes gate archived ids (409) before calling in.
 */
export function assignmentDetail(db: Database, id: number): AssignmentDetailResult {
  const row = db
    .prepare(
      `
      SELECT
        da.id,
        da.assigned_for_date,
        da.status,
        da.origin,
        da.time_spent_ms,
        da.study_item_id,
        si.surface_form,
        si.selected_reading,
        si.dictionary_entry_id
      FROM daily_assignment da
      JOIN study_item si ON si.id = da.study_item_id
      WHERE da.id = ?
      `
    )
    .get(id) as
    | {
        id: number;
        assigned_for_date: string;
        status: AssignmentStatus;
        origin: AssignmentOrigin;
        time_spent_ms: number | null;
        study_item_id: number;
        surface_form: string;
        selected_reading: string;
        dictionary_entry_id: number;
      }
    | undefined;

  if (!row) {
    return { kind: 'not_found', message: 'Assignment not found' };
  }

  const entry = getEntryDetails(row.dictionary_entry_id);
  if (!entry) {
    return { kind: 'not_found', message: 'Dictionary entry not found' };
  }

  const kanjiRows = db
    .prepare(
      `
      SELECT
        sik.position,
        k.literal,
        k.meanings_json,
        k.onyomi_json,
        k.kunyomi_json,
        k.stroke_count,
        k.grade,
        k.jlpt_level,
        k.frequency_rank,
        ksa.asset_path
      FROM study_item_kanji sik
      JOIN kanji k ON k.literal = sik.kanji_literal
      LEFT JOIN kanji_stroke_asset ksa ON ksa.kanji_literal = k.literal
      WHERE sik.study_item_id = ?
      ORDER BY sik.position ASC
      `
    )
    .all(row.study_item_id) as Array<{
    position: number;
    literal: string;
    meanings_json: string;
    onyomi_json: string;
    kunyomi_json: string;
    stroke_count: number;
    grade: number | null;
    jlpt_level: number | null;
    frequency_rank: number | null;
    asset_path: string | null;
  }>;

  return {
    kind: 'ok',
    payload: {
      assignment: {
        id: row.id,
        assigned_for_date: row.assigned_for_date,
        status: row.status,
        origin: row.origin,
        time_spent_ms: row.time_spent_ms
      },
      study_item: {
        id: row.study_item_id,
        surface_form: row.surface_form,
        selected_reading: row.selected_reading
      },
      dictionary_entry: {
        id: entry.id,
        is_common: entry.is_common,
        primary_spelling: entry.spellings[0]?.text ?? row.surface_form,
        primary_reading: entry.readings[0]?.text ?? row.selected_reading,
        senses: entry.senses.map((sense) => ({
          sense_index: sense.sense_index,
          glosses: sense.glosses,
          parts_of_speech: sense.parts_of_speech
        }))
      },
      kanji: kanjiRows.map((item) => ({
        literal: item.literal,
        position: item.position,
        meanings: safeJsonParse<string[]>(item.meanings_json),
        onyomi: safeJsonParse<string[]>(item.onyomi_json),
        kunyomi: safeJsonParse<string[]>(item.kunyomi_json),
        stroke_count: item.stroke_count,
        grade: item.grade,
        jlpt_level: item.jlpt_level,
        frequency_rank: item.frequency_rank,
        stroke_asset_url: item.asset_path ? `/static/${item.asset_path}` : null
      }))
    }
  };
}
