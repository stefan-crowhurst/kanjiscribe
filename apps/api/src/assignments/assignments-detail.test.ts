import { beforeEach, describe, expect, it } from 'vitest';

import { assignmentDetail } from './detail.js';
import { sqlite } from '../test-setup.js';
import {
  resetCounters,
  resetDb,
  seedAssignment,
  seedStudyItem,
  seedStudyItemKanji
} from '../test-helpers.js';

/**
 * Seed a word whose entry carries real spellings, readings, and senses, a
 * kanji with populated readings and a stroke asset, and a study-item/kanji
 * join — so the serialized detail payload is pinned against known literals
 * rather than fallbacks.
 */
function seedRichWord(): number {
  const ts = '2024-01-01T00:00:00.000Z';

  sqlite
    .prepare(
      `INSERT INTO kanji (literal, meanings_json, onyomi_json, kunyomi_json, stroke_count, grade, jlpt_level, frequency_rank)
       VALUES ('山', ?, ?, ?, 3, 5, 2, 150)`
    )
    .run(JSON.stringify(['mountain']), JSON.stringify(['さん', 'せん']), JSON.stringify(['やま']));

  sqlite
    .prepare(
      `INSERT INTO kanji_stroke_asset (kanji_literal, asset_path, source_version, updated_at)
       VALUES ('山', 'kanjivg/山.svg', 'kanjivg-20240101', ?)`
    )
    .run(ts);

  sqlite
    .prepare(
      `INSERT INTO dictionary_entry (id, is_common, priority_rank, created_at, updated_at)
       VALUES (1, 1, NULL, ?, ?)`
    )
    .run(ts, ts);

  sqlite
    .prepare(
      `INSERT INTO entry_spelling (entry_id, text, is_primary, priority_rank)
       VALUES (1, '山', 1, NULL)`
    )
    .run();

  sqlite
    .prepare(
      `INSERT INTO entry_reading (entry_id, text, is_primary, no_kanji)
       VALUES (1, 'やま', 1, 0)`
    )
    .run();

  sqlite
    .prepare(
      `INSERT INTO entry_sense (entry_id, sense_index, glosses_json, parts_of_speech_json, misc_tags_json, field_tags_json, dialect_tags_json, info_json)
       VALUES (1, 1, ?, ?, '[]', '[]', '[]', '[]')`
    )
    .run(JSON.stringify(['mountain', 'mine']), JSON.stringify(['noun']));

  const studyItemId = seedStudyItem(sqlite, 1, { surface_form: '山', selected_reading: 'やま' });
  seedStudyItemKanji(studyItemId, [{ position: 0, literal: '山' }]);
  return studyItemId;
}

describe('assignmentDetail', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('returns the full shared payload for a normal assignment', () => {
    const studyItemId = seedRichWord();
    const assignment = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 45000
    });

    expect(assignmentDetail(sqlite, assignment.id)).toEqual({
      kind: 'ok',
      payload: {
        assignment: {
          id: assignment.id,
          assigned_for_date: '2024-01-01',
          status: 'completed',
          origin: 'manual',
          time_spent_ms: 45000
        },
        study_item: { id: studyItemId, surface_form: '山', selected_reading: 'やま' },
        dictionary_entry: {
          id: 1,
          is_common: true,
          primary_spelling: '山',
          primary_reading: 'やま',
          senses: [{ sense_index: 1, glosses: ['mountain', 'mine'], parts_of_speech: ['noun'] }]
        },
        kanji: [
          {
            literal: '山',
            position: 0,
            meanings: ['mountain'],
            onyomi: ['さん', 'せん'],
            kunyomi: ['やま'],
            stroke_count: 3,
            grade: 5,
            jlpt_level: 2,
            frequency_rank: 150,
            stroke_asset_url: '/static/kanjivg/山.svg'
          }
        ]
      }
    });
  });

  it('returns not_found with "Assignment not found" for an unknown id', () => {
    expect(assignmentDetail(sqlite, 99999)).toEqual({
      kind: 'not_found',
      message: 'Assignment not found'
    });
  });

  it('returns not_found with "Dictionary entry not found" when the entry is missing', () => {
    // An orphan study_item (entry row deleted outside the FK contract) models
    // the defensive branch: the assignment exists but its entry does not.
    sqlite.exec('PRAGMA foreign_keys = OFF');
    try {
      sqlite
        .prepare(
          `INSERT INTO study_item (id, surface_form, selected_reading, dictionary_entry_id, source_type, created_at)
           VALUES (77, '孤児', 'こじ', 9999, 'manual', '2024-01-01T00:00:00.000Z')`
        )
        .run();
    } finally {
      sqlite.exec('PRAGMA foreign_keys = ON');
    }

    const assignment = seedAssignment({ study_item_id: 77 });

    expect(assignmentDetail(sqlite, assignment.id)).toEqual({
      kind: 'not_found',
      message: 'Dictionary entry not found'
    });
  });
});
