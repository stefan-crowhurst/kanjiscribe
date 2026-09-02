import { beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  dictionaryEntryDetailResponseSchema,
  dictionarySearchResponseSchema,
  intakeResponseSchema
} from '@kanjiscribe/shared';

import { app } from '../server.js';
import { sqlite } from '../db/client.js';
import { resetCounters, resetDb, seedAssignment, seedStudyItem } from '../test-helpers.js';

/**
 * Contract test (ADR-0006): the bytes the dictionary and intake routes
 * actually serialize must parse through the shared response schemas. The
 * shared schemas are the single source of truth — a route drifting from its
 * schema fails here, not in the browser.
 */
function parseWith<T extends z.ZodTypeAny>(schema: T, body: string): z.infer<T> {
  const parsed = schema.safeParse(JSON.parse(body));
  if (!parsed.success) {
    throw new Error(`Response rejected by shared schema: ${JSON.stringify(parsed.error.issues, null, 2)}`);
  }
  return parsed.data;
}

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

describe('dictionary + intake response contract — api bytes parse through the shared schemas', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  /** Entry 1: common with a full detail payload. Entry 2: uncommon, NULL rank. */
  function seedDictionaryData(): void {
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
          glosses_json: JSON.stringify(['shape', 'form', 'appearance', 'figure', 'face', 'type']),
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
    seedEntry({
      id: 2,
      is_common: 0,
      priority_rank: null,
      spellings: [{ text: '日本語', is_primary: 1 }],
      readings: [{ text: 'にほんご', is_primary: 1 }]
    });
  }

  function intakePayload(overrides?: { assigned_for_date?: string }) {
    return {
      surface_form: '形1',
      selected_reading: 'よみ1',
      dictionary_entry_id: 1,
      source_type: 'manual',
      assigned_for_date: overrides?.assigned_for_date ?? '2024-01-02'
    };
  }

  function postIntake(payload: ReturnType<typeof intakePayload>) {
    return app.inject({
      method: 'POST',
      url: '/study-items/intake',
      payload: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' }
    });
  }

  it('search response parses through dictionarySearchResponseSchema with match_type and today_assigned', async () => {
    seedDictionaryData();
    const item = seedStudyItem(sqlite, 1, { surface_form: '形', selected_reading: 'かたち' });
    seedAssignment({ study_item_id: item, assigned_for_date: todayIso(), status: 'pending' });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=形' });
    expect(res.statusCode).toBe(200);

    const search = parseWith(dictionarySearchResponseSchema, res.body);
    const hit = search.results.find((r) => r.entry_id === 1);
    expect(hit).toBeDefined();
    expect(hit!.match_type).toBe('exact_spelling');
    expect(hit!.today_assigned).toBe(true);
    expect(hit!.is_common).toBe(true);
    expect(hit!.primary_spelling).toBe('形');
    expect(hit!.primary_reading).toBe('かたち');
    // Glosses are sliced to the first 5 even when more exist.
    expect(hit!.glosses).toEqual(['shape', 'form', 'appearance', 'figure', 'face']);
    expect(hit!.readings).toEqual([
      { text: 'かたち', no_kanji: false },
      { text: 'けい', no_kanji: false }
    ]);
    expect(hit!.spellings).toEqual([
      { text: '形', is_primary: true },
      { text: 'かたち', is_primary: false },
      { text: '型', is_primary: false }
    ]);
  });

  it('entry detail response parses through dictionaryEntryDetailResponseSchema including senses and restrictions', async () => {
    seedDictionaryData();

    const res = await app.inject({ method: 'GET', url: '/dictionary/entries/1' });
    expect(res.statusCode).toBe(200);

    const detail = parseWith(dictionaryEntryDetailResponseSchema, res.body);
    expect(detail.entry.id).toBe(1);
    expect(detail.entry.is_common).toBe(true);
    expect(detail.entry.priority_rank).toBe(3);
    expect(detail.entry.senses[0]).toMatchObject({
      sense_index: 0,
      glosses: ['shape', 'form', 'appearance', 'figure', 'face', 'type'],
      parts_of_speech: ['noun'],
      misc_tags: [],
      field_tags: [],
      dialect_tags: [],
      info: ['見出し']
    });
    expect(detail.entry.reading_restrictions).toEqual([
      { reading_text: 'けい', spelling_text: '型' },
      { reading_text: 'けい', spelling_text: '形' }
    ]);

    // NULL priority_rank parses as well.
    const res2 = await app.inject({ method: 'GET', url: '/dictionary/entries/2' });
    expect(res2.statusCode).toBe(200);
    const detail2 = parseWith(dictionaryEntryDetailResponseSchema, res2.body);
    expect(detail2.entry.priority_rank).toBeNull();
  });

  it('intake 201 response parses through intakeResponseSchema', async () => {
    seedDictionaryData();

    const res = await postIntake(intakePayload());
    expect(res.statusCode).toBe(201);

    const body = parseWith(intakeResponseSchema, res.body);
    expect(body.study_item).toMatchObject({
      surface_form: '形1',
      selected_reading: 'よみ1',
      dictionary_entry_id: 1,
      source_type: 'manual',
      is_new: true
    });
    expect(body.assignment).toMatchObject({
      assigned_for_date: '2024-01-02',
      status: 'pending',
      origin: 'manual'
    });
    expect(body.assignment.study_item_id).toBe(body.study_item.id);
  });

  it('intake 200 (unarchive-reactivate) response parses through intakeResponseSchema', async () => {
    seedDictionaryData();

    const first = await postIntake(intakePayload());
    expect(first.statusCode).toBe(201);
    const created = parseWith(intakeResponseSchema, first.body);

    // Remove the assignment, then re-add the same word for the same date.
    await app.inject({ method: 'POST', url: `/assignments/${created.assignment.id}/archive` });
    const second = await postIntake(intakePayload());
    expect(second.statusCode).toBe(200);

    const reactivated = parseWith(intakeResponseSchema, second.body);
    expect(reactivated.assignment.id).toBe(created.assignment.id);
    expect(reactivated.assignment.status).toBe('pending');
    // The study item pre-existed, so the re-add is not a new item.
    expect(reactivated.study_item.is_new).toBe(false);
  });
});

describe('intake normalizes the selected reading to the entry’s canonical reading (ADR 0010)', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  function seedCanonicalEntry(): void {
    seedEntry({
      id: 3,
      is_common: 1,
      spellings: [{ text: '蓋', is_primary: 1 }],
      readings: [
        { text: 'ふた', is_primary: 1, no_kanji: 0 },
        { text: 'がい', is_primary: 0, no_kanji: 0 }
      ]
    });
  }

  function intakeWith(payload: {
    surface_form: string;
    selected_reading: string;
    dictionary_entry_id: number;
    assigned_for_date?: string;
  }) {
    return app.inject({
      method: 'POST',
      url: '/study-items/intake',
      payload: JSON.stringify({
        source_type: 'manual',
        assigned_for_date: '2024-01-02',
        ...payload
      }),
      headers: { 'content-type': 'application/json' }
    });
  }

  it('stores the canonical hiragana reading when the payload carries the katakana variant', async () => {
    seedCanonicalEntry();

    const res = await intakeWith({
      surface_form: '蓋',
      selected_reading: 'フタ',
      dictionary_entry_id: 3
    });
    expect(res.statusCode).toBe(201);

    const body = parseWith(intakeResponseSchema, res.body);
    expect(body.study_item).toMatchObject({
      surface_form: '蓋',
      selected_reading: 'ふた',
      dictionary_entry_id: 3,
      is_new: true
    });
  });

  it('keeps a genuinely katakana reading when its entry stores no hiragana twin', async () => {
    seedEntry({
      id: 4,
      is_common: 1,
      spellings: [{ text: 'ダンス', is_primary: 1 }],
      readings: [{ text: 'ダンス', is_primary: 1 }]
    });

    const res = await intakeWith({
      surface_form: 'ダンス',
      selected_reading: 'ダンス',
      dictionary_entry_id: 4
    });
    expect(res.statusCode).toBe(201);

    const body = parseWith(intakeResponseSchema, res.body);
    expect(body.study_item.selected_reading).toBe('ダンス');
  });

  it('never rewrites a reading the entry does not store', async () => {
    seedCanonicalEntry();

    const res = await intakeWith({
      surface_form: '蓋',
      selected_reading: 'バナナ',
      dictionary_entry_id: 3
    });
    expect(res.statusCode).toBe(201);

    const body = parseWith(intakeResponseSchema, res.body);
    // バナナ shares no identity with a stored reading, so it is kept as
    // written — never folded into a ばなな the entry does not store.
    expect(body.study_item.selected_reading).toBe('バナナ');
  });

  it('deduplicates a katakana-variant payload against an existing canonical study item', async () => {
    seedCanonicalEntry();
    const existing = seedStudyItem(sqlite, 3, { surface_form: '蓋', selected_reading: 'ふた' });

    const res = await intakeWith({
      surface_form: '蓋',
      selected_reading: 'フタ',
      dictionary_entry_id: 3
    });
    expect(res.statusCode).toBe(201);

    const body = parseWith(intakeResponseSchema, res.body);
    expect(body.study_item.id).toBe(existing);
    expect(body.study_item.is_new).toBe(false);
    expect(body.study_item.selected_reading).toBe('ふた');

    const count = sqlite
      .prepare(`SELECT COUNT(*) AS count FROM study_item WHERE dictionary_entry_id = 3`)
      .get() as { count: number };
    expect(count.count).toBe(1);
  });

  it('never creates a second study item across days once a variant has been normalized', async () => {
    seedCanonicalEntry();

    const first = await intakeWith({
      surface_form: '蓋',
      selected_reading: 'フタ',
      dictionary_entry_id: 3,
      assigned_for_date: '2024-01-02'
    });
    expect(first.statusCode).toBe(201);
    const firstBody = parseWith(intakeResponseSchema, first.body);
    expect(firstBody.study_item.selected_reading).toBe('ふた');

    const second = await intakeWith({
      surface_form: '蓋',
      selected_reading: 'フタ',
      dictionary_entry_id: 3,
      assigned_for_date: '2024-01-03'
    });
    expect(second.statusCode).toBe(201);
    const secondBody = parseWith(intakeResponseSchema, second.body);
    expect(secondBody.study_item.id).toBe(firstBody.study_item.id);
    expect(secondBody.study_item.is_new).toBe(false);

    const count = sqlite
      .prepare(`SELECT COUNT(*) AS count FROM study_item WHERE dictionary_entry_id = 3`)
      .get() as { count: number };
    expect(count.count).toBe(1);
  });
});
