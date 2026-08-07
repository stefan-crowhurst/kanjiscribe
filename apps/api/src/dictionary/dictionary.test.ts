import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../server.js';
import { sqlite } from '../test-setup.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from '../test-helpers.js';

type SeedSpelling = { text: string; is_primary?: number; priority_rank?: number | null };
type SeedReading = { text: string; is_primary?: number; no_kanji?: number };
type SeedSense = {
  sense_index: number;
  glosses_json?: string;
  parts_of_speech_json?: string;
  misc_tags_json?: string;
  field_tags_json?: string;
  dialect_tags_json?: string;
  info_json?: string;
};

function seedEntry(opts: {
  id: number;
  is_common?: number;
  priority_rank?: number | null;
  spellings?: SeedSpelling[];
  readings?: SeedReading[];
  senses?: SeedSense[];
  reading_restrictions?: Array<{ reading_text: string; spelling_text: string }>;
}): void {
  const ts = '2024-01-01T00:00:00.000Z';
  sqlite
    .prepare(
      `INSERT INTO dictionary_entry (id, is_common, priority_rank, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(opts.id, opts.is_common ?? 1, opts.priority_rank ?? null, ts, ts);

  for (const spelling of opts.spellings ?? []) {
    sqlite
      .prepare(
        `INSERT INTO entry_spelling (entry_id, text, is_primary, priority_rank)
         VALUES (?, ?, ?, ?)`
      )
      .run(opts.id, spelling.text, spelling.is_primary ?? 0, spelling.priority_rank ?? null);
  }

  for (const reading of opts.readings ?? []) {
    sqlite
      .prepare(
        `INSERT INTO entry_reading (entry_id, text, is_primary, no_kanji)
         VALUES (?, ?, ?, ?)`
      )
      .run(opts.id, reading.text, reading.is_primary ?? 0, reading.no_kanji ?? 0);
  }

  for (const sense of opts.senses ?? []) {
    sqlite
      .prepare(
        `INSERT INTO entry_sense (
           entry_id, sense_index, glosses_json, parts_of_speech_json,
           misc_tags_json, field_tags_json, dialect_tags_json, info_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        opts.id,
        sense.sense_index,
        sense.glosses_json ?? '[]',
        sense.parts_of_speech_json ?? '[]',
        sense.misc_tags_json ?? '[]',
        sense.field_tags_json ?? '[]',
        sense.dialect_tags_json ?? '[]',
        sense.info_json ?? '[]'
      );
  }

  for (const restriction of opts.reading_restrictions ?? []) {
    sqlite
      .prepare(
        `INSERT INTO entry_reading_spelling (entry_id, reading_text, spelling_text)
         VALUES (?, ?, ?)`
      )
      .run(opts.id, restriction.reading_text, restriction.spelling_text);
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('GET /dictionary/search', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('returns 400 for a missing or empty q', async () => {
    const res = await app.inject({ method: 'GET', url: '/dictionary/search' });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({ error: expect.any(String) });
  });

  it('ranks exact matches above prefix matches', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: '日本', is_primary: 1 }],
      readings: [{ text: 'にほん', is_primary: 1 }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: '日本語', is_primary: 1 }],
      readings: [{ text: 'にほんご', is_primary: 1 }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=日本' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      results: Array<{ entry_id: number; match_type: string }>;
    };
    expect(body.results.map((r) => r.entry_id)).toEqual([1, 2]);
    expect(body.results[0]?.match_type).toBe('exact_spelling');
    expect(body.results[1]?.match_type).toBe('prefix_spelling');
  });

  it('ranks common entries above uncommon entries within a match tier', async () => {
    seedEntry({
      id: 1,
      is_common: 0,
      priority_rank: 1,
      spellings: [{ text: '日本語', is_primary: 1 }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      priority_rank: 500,
      spellings: [{ text: '日本料理', is_primary: 1 }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=日本' });

    const body = JSON.parse(res.body) as { results: Array<{ entry_id: number }> };
    expect(body.results.map((r) => r.entry_id)).toEqual([2, 1]);
  });

  it('returns primary spelling, reading, sliced glosses, readings, spellings and today_assigned', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      priority_rank: 7,
      spellings: [
        { text: '形', is_primary: 1 },
        { text: 'かたち', is_primary: 0 }
      ],
      readings: [
        { text: 'かたち', is_primary: 1, no_kanji: 0 },
        { text: 'けい', is_primary: 0, no_kanji: 0 }
      ],
      senses: [{ sense_index: 0, glosses_json: JSON.stringify(['shape', 'form', 'appearance', 'figure', 'face', 'type']) }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=形' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      results: Array<{
        entry_id: number;
        primary_spelling: string | null;
        primary_reading: string | null;
        glosses: string[];
        is_common: boolean;
        readings: Array<{ text: string; no_kanji: boolean }>;
        spellings: Array<{ text: string; is_primary: boolean }>;
        today_assigned: boolean;
        match_type: string;
        priority_rank?: unknown;
      }>;
    };
    expect(body.results).toHaveLength(1);
    const result = body.results[0]!;
    expect(result).toMatchObject({
      entry_id: 1,
      primary_spelling: '形',
      primary_reading: 'かたち',
      is_common: true,
      today_assigned: false,
      match_type: 'exact_spelling'
    });
    // Glosses are sliced to the first 5 even when more exist.
    expect(result.glosses).toEqual(['shape', 'form', 'appearance', 'figure', 'face']);
    // priority_rank is stripped from the response payload.
    expect(result.priority_rank).toBeUndefined();
    expect(result.readings).toEqual([
      { text: 'かたち', no_kanji: false },
      { text: 'けい', no_kanji: false }
    ]);
    expect(result.spellings).toEqual([
      { text: '形', is_primary: true },
      { text: 'かたち', is_primary: false }
    ]);
  });

  it('flags entries with a non-archived assignment for today', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: '日本', is_primary: 1 }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: '日本語', is_primary: 1 }]
    });
    const todayItem = seedStudyItem(sqlite, 1);
    const archivedItem = seedStudyItem(sqlite, 2);
    seedAssignment({ study_item_id: todayItem, assigned_for_date: todayIso(), status: 'pending' });
    seedAssignment({ study_item_id: archivedItem, assigned_for_date: todayIso(), status: 'archived' });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=日本' });

    const body = JSON.parse(res.body) as { results: Array<{ entry_id: number; today_assigned: boolean }> };
    expect(body.results.find((r) => r.entry_id === 1)?.today_assigned).toBe(true);
    expect(body.results.find((r) => r.entry_id === 2)?.today_assigned).toBe(false);
  });
});

describe('GET /dictionary/entries/:id', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('returns the full entry detail shape', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      priority_rank: 3,
      spellings: [
        { text: '形', is_primary: 1, priority_rank: 1 },
        { text: 'かたち', is_primary: 0, priority_rank: 5 },
        { text: '型', is_primary: 0, priority_rank: 9 }
      ],
      readings: [
        { text: 'かたち', is_primary: 1, no_kanji: 0 },
        { text: 'けい', is_primary: 0, no_kanji: 0 }
      ],
      senses: [
        {
          sense_index: 0,
          glosses_json: JSON.stringify(['shape']),
          parts_of_speech_json: JSON.stringify(['noun']),
          info_json: JSON.stringify(['見出し'])
        },
        {
          sense_index: 1,
          glosses_json: JSON.stringify(['form']),
          parts_of_speech_json: JSON.stringify(['noun']),
          misc_tags_json: JSON.stringify(['rare'])
        }
      ],
      reading_restrictions: [
        { reading_text: 'けい', spelling_text: '形' },
        { reading_text: 'けい', spelling_text: '型' }
      ]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/entries/1' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      entry: {
        id: number;
        is_common: boolean;
        priority_rank: number | null;
        spellings: Array<{ text: string; is_primary: boolean; priority_rank: number | null }>;
        readings: Array<{ text: string; is_primary: boolean; no_kanji: boolean }>;
        senses: Array<{
          sense_index: number;
          glosses: string[];
          parts_of_speech: string[];
          misc_tags: string[];
          field_tags: string[];
          dialect_tags: string[];
          info: string[];
        }>;
        reading_restrictions: Array<{ reading_text: string; spelling_text: string }>;
      };
    };
    expect(body.entry).toEqual({
      id: 1,
      is_common: true,
      priority_rank: 3,
      spellings: [
        { text: '形', is_primary: true, priority_rank: 1 },
        { text: 'かたち', is_primary: false, priority_rank: 5 },
        { text: '型', is_primary: false, priority_rank: 9 }
      ],
      readings: [
        { text: 'かたち', is_primary: true, no_kanji: false },
        { text: 'けい', is_primary: false, no_kanji: false }
      ],
      senses: [
        {
          sense_index: 0,
          glosses: ['shape'],
          parts_of_speech: ['noun'],
          misc_tags: [],
          field_tags: [],
          dialect_tags: [],
          info: ['見出し']
        },
        {
          sense_index: 1,
          glosses: ['form'],
          parts_of_speech: ['noun'],
          misc_tags: ['rare'],
          field_tags: [],
          dialect_tags: [],
          info: []
        }
      ],
      reading_restrictions: [
        { reading_text: 'けい', spelling_text: '型' },
        { reading_text: 'けい', spelling_text: '形' }
      ]
    });
  });

  it('returns 404 for a missing entry', async () => {
    const res = await app.inject({ method: 'GET', url: '/dictionary/entries/999' });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toEqual({ error: 'Dictionary entry not found' });
  });

  it('returns 400 for a non-positive id', async () => {
    for (const bad of ['abc', '0', '-3']) {
      const res = await app.inject({ method: 'GET', url: `/dictionary/entries/${bad}` });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: 'Invalid entry id' });
    }
  });
});
