import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { sqlite } from './db/client.js';
import {
  resetCounters,
  resetDb,
  seedAssignment,
  seedStudyItem,
  seedStudyItemKanji
} from './test-helpers.js';

/**
 * JSON-column loud-failure contract (zod validation sweep): a corrupt
 * payload in a JSON column (glosses, tags, kanji meanings/readings) must
 * fail loudly — 500 with a logged error — on every surface that renders it,
 * never a silent empty list. Valid payloads parse exactly as they did under
 * the old silent helper, including a NULL first-gloss subquery (an entry
 * with no senses), which stays an empty list.
 */
describe('JSON columns parse through the shared schema, failing loudly', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  function seedEntryWithSense(glossesJson: string, senseOverrides: { info_json?: string } = {}): void {
    const ts = '2024-01-01T00:00:00.000Z';
    sqlite
      .prepare(
        `INSERT INTO dictionary_entry (id, is_common, priority_rank, created_at, updated_at)
         VALUES (1, 1, NULL, ?, ?)`
      )
      .run(ts, ts);
    sqlite
      .prepare(
        `INSERT INTO entry_spelling (entry_id, text, is_primary, priority_rank)
         VALUES (1, '形', 1, NULL)`
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO entry_sense (entry_id, sense_index, glosses_json, parts_of_speech_json, misc_tags_json, field_tags_json, dialect_tags_json, info_json)
         VALUES (1, 0, ?, '[]', '[]', '[]', '[]', ?)`
      )
      .run(glossesJson, senseOverrides.info_json ?? '[]');
  }

  function seedCorruptKanji(literal: string, corruptColumn: 'meanings_json' | 'onyomi_json'): void {
    const meanings = corruptColumn === 'meanings_json' ? 'not json' : '[]';
    const onyomi = corruptColumn === 'onyomi_json' ? 'not json' : '[]';
    sqlite
      .prepare(
        `INSERT INTO kanji (literal, meanings_json, onyomi_json, kunyomi_json, stroke_count, grade, jlpt_level, frequency_rank)
         VALUES (?, ?, ?, '[]', 3, NULL, NULL, NULL)`
      )
      .run(literal, meanings, onyomi);
  }

  it('entry detail fails loudly on a corrupt glosses column', async () => {
    seedEntryWithSense('not json');

    const res = await app.inject({ method: 'GET', url: '/dictionary/entries/1' });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'Internal server error' });
  });

  it('entry detail fails loudly on a corrupt info column', async () => {
    seedEntryWithSense('[]', { info_json: '{"broken":' });

    const res = await app.inject({ method: 'GET', url: '/dictionary/entries/1' });
    expect(res.statusCode).toBe(500);
  });

  it('entry detail fails loudly when the column is valid JSON but not a string array', async () => {
    seedEntryWithSense('"not-an-array"');

    const res = await app.inject({ method: 'GET', url: '/dictionary/entries/1' });
    expect(res.statusCode).toBe(500);
  });

  it('dictionary search fails loudly on a corrupt first-gloss column', async () => {
    seedEntryWithSense('not json');

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=形' });
    expect(res.statusCode).toBe(500);
  });

  it('dictionary search keeps an empty gloss list for an entry with no senses (NULL column)', async () => {
    const ts = '2024-01-01T00:00:00.000Z';
    sqlite
      .prepare(
        `INSERT INTO dictionary_entry (id, is_common, priority_rank, created_at, updated_at)
         VALUES (1, 1, NULL, ?, ?)`
      )
      .run(ts, ts);
    sqlite
      .prepare(
        `INSERT INTO entry_spelling (entry_id, text, is_primary, priority_rank)
         VALUES (1, '形', 1, NULL)`
      )
      .run();

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=形' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { results: Array<{ glosses: string[] }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.glosses).toEqual([]);
  });

  it('word view fails loudly on a corrupt kanji meanings column', async () => {
    seedCorruptKanji('山', 'meanings_json');
    const studyItemId = seedStudyItem(sqlite, 1, { surface_form: '山', selected_reading: 'やま' });
    seedStudyItemKanji(studyItemId, [{ position: 0, literal: '山' }]);
    const assignment = seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01',
      status: 'pending'
    });

    const res = await app.inject({ method: 'GET', url: `/assignments/${assignment.id}/view` });
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual({ error: 'Internal server error' });
  });

  it('kanji stats fail loudly on a corrupt meanings column', async () => {
    seedCorruptKanji('永', 'meanings_json');

    const res = await app.inject({ method: 'GET', url: `/stats/kanji/${encodeURIComponent('永')}` });
    expect(res.statusCode).toBe(500);
  });

  it('top-kanji fails loudly on a corrupt onyomi column', async () => {
    seedCorruptKanji('永', 'onyomi_json');
    const studyItemId = seedStudyItem(sqlite, 1, { surface_form: '永', selected_reading: 'えい' });
    seedStudyItemKanji(studyItemId, [{ position: 0, literal: '永' }]);
    seedAssignment({ study_item_id: studyItemId, assigned_for_date: '2024-01-01', status: 'pending' });

    const res = await app.inject({ method: 'GET', url: '/stats/top-kanji' });
    expect(res.statusCode).toBe(500);
  });
});
