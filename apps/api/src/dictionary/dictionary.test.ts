import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../server.js';
import { sqlite } from '../test-setup.js';
import {
  resetCounters,
  resetDb,
  seedAssignment,
  seedEntry,
  seedStudyItem
} from '../test-helpers.js';

type SearchMatchResult = { entry_id: number; match_type: string };

function parseSearchMatches(body: string): SearchMatchResult[] {
  return (JSON.parse(body) as { results: SearchMatchResult[] }).results;
}

function search(query: string) {
  return app.inject({
    method: 'GET',
    url: `/dictionary/search?q=${encodeURIComponent(query)}`
  });
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
    const results = parseSearchMatches(res.body);
    expect(results.map((r) => r.entry_id)).toEqual([1, 2]);
    expect(results[0]?.match_type).toBe('exact_spelling');
    expect(results[1]?.match_type).toBe('prefix_spelling');
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
      senses: [
        {
          sense_index: 0,
          glosses_json: JSON.stringify(['shape', 'form', 'appearance', 'figure', 'face', 'type'])
        }
      ]
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
    seedAssignment({
      study_item_id: archivedItem,
      assigned_for_date: todayIso(),
      status: 'archived'
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=日本' });

    const body = JSON.parse(res.body) as {
      results: Array<{ entry_id: number; today_assigned: boolean }>;
    };
    expect(body.results.find((r) => r.entry_id === 1)?.today_assigned).toBe(true);
    expect(body.results.find((r) => r.entry_id === 2)?.today_assigned).toBe(false);
  });
});

describe('GET /dictionary/search — script-insensitive reading search (ADR 0010)', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('finds a hiragana-stored reading when the query is typed in katakana', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: 'あっさり', is_primary: 1 }],
      readings: [{ text: 'あっさり', is_primary: 1 }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=アッサリ' });

    expect(res.statusCode).toBe(200);
    const results = parseSearchMatches(res.body);
    expect(results.map((r) => r.entry_id)).toEqual([1]);
    expect(results[0]?.match_type).toBe('exact_reading');
  });

  it('finds a katakana-stored reading when the query is typed in hiragana', async () => {
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: 'ダンス', is_primary: 1 }],
      readings: [{ text: 'ダンス', is_primary: 1 }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=だんす' });

    expect(res.statusCode).toBe(200);
    const results = parseSearchMatches(res.body);
    expect(results.map((r) => r.entry_id)).toEqual([2]);
    expect(results[0]?.match_type).toBe('exact_reading');
  });

  it('ranks an exact reading match via one script variant above a prefix match via the other', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: 'あっさり', is_primary: 1 }],
      readings: [{ text: 'あっさり', is_primary: 1 }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      // あっさり味 does not prefix-match the raw katakana query アッサリ, so
      // the only spelling-tier match is the exact hiragana spelling of entry
      // 1's twin — the reading-tier prefix is what ranks second.
      spellings: [{ text: 'あっさり味', is_primary: 1 }],
      readings: [{ text: 'アッサリテイスト', is_primary: 1 }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=アッサリ' });

    const results = parseSearchMatches(res.body);
    expect(results.map((r) => r.entry_id)).toEqual([1, 2]);
    expect(results[0]?.match_type).toBe('exact_reading');
    expect(results[1]?.match_type).toBe('prefix_reading');
  });

  it('leaves spelling search unaffected: a script-variant query still matches by reading, not spelling', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: 'だんす', is_primary: 1 }],
      readings: [{ text: 'ダンス', is_primary: 1 }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=ダンス' });

    const results = parseSearchMatches(res.body);
    // ダンス (katakana) does not match the hiragana spelling だんす, and the
    // reading match happens via the folded katakana form — still a
    // reading-tier match, never a spelling-tier match.
    expect(results.map((r) => r.entry_id)).toEqual([1]);
    expect(results[0]?.match_type).toBe('exact_reading');
  });

  it('a mixed-script reading keeps matching its own stored form', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      // アホ does not match the query, so the hit is a reading-tier match.
      spellings: [{ text: 'アホ', is_primary: 1 }],
      readings: [{ text: 'バカな', is_primary: 1 }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=バカな' });

    const results = parseSearchMatches(res.body);
    // バカな folds to neither pure script, so the raw query itself must
    // match — otherwise the entry becomes unfindable by its own reading.
    expect(results.map((r) => r.entry_id)).toEqual([1]);
    expect(results[0]?.match_type).toBe('exact_reading');
  });

  it('serves at most one reading per script identity in collapsed search results', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: 'あっさり', is_primary: 1 }],
      readings: [{ text: 'あっさり', is_primary: 1 }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=アッサリ' });

    const body = JSON.parse(res.body) as {
      results: Array<{ readings: Array<{ text: string; no_kanji: boolean }> }>;
    };
    expect(body.results[0]?.readings).toEqual([{ text: 'あっさり', no_kanji: false }]);
  });
});

describe('GET /dictionary/search — romaji reading search (ADR 0011)', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('finds an entry by its full romaji reading as an exact match', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: '食べる', is_primary: 1 }],
      readings: [{ text: 'たべる', is_primary: 1, romaji: 'taberu' }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: '食べ物', is_primary: 1 }],
      readings: [{ text: 'たべもの', is_primary: 1, romaji: 'tabemono' }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=taberu' });

    expect(res.statusCode).toBe(200);
    const results = parseSearchMatches(res.body);
    expect(results.map((r) => r.entry_id)).toEqual([1]);
    expect(results[0]?.match_type).toBe('exact_reading');
  });

  it('finds entries by a romaji prefix as prefix-reading matches', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: '食べる', is_primary: 1 }],
      readings: [{ text: 'たべる', is_primary: 1, romaji: 'taberu' }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: '食べ物', is_primary: 1 }],
      readings: [{ text: 'たべもの', is_primary: 1, romaji: 'tabemono' }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=tabe' });

    expect(res.statusCode).toBe(200);
    const results = parseSearchMatches(res.body);
    expect(results.map((r) => r.entry_id)).toEqual([1, 2]);
    expect(results.every((r) => r.match_type === 'prefix_reading')).toBe(true);
  });

  it('finds a katakana-only reading by romaji', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: 'ドリンク', is_primary: 1 }],
      readings: [{ text: 'ドリンク', is_primary: 1, no_kanji: 1, romaji: 'dorinku' }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=dorinku' });

    expect(res.statusCode).toBe(200);
    const results = parseSearchMatches(res.body);
    expect(results.map((r) => r.entry_id)).toEqual([1]);
    expect(results[0]?.match_type).toBe('exact_reading');
  });

  it('spells long katakana vowels as literal vowel sequences (koohii)', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: 'コーヒー', is_primary: 1 }],
      readings: [{ text: 'コーヒー', is_primary: 1, no_kanji: 1, romaji: 'koohii' }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=koohii' });

    expect(res.statusCode).toBe(200);
    const results = parseSearchMatches(res.body);
    expect(results.map((r) => r.entry_id)).toEqual([1]);
    expect(results[0]?.match_type).toBe('exact_reading');
  });

  it('matches only strict Hepburn forms, never the accepted recall gaps', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: 'コーヒー', is_primary: 1 }],
      readings: [{ text: 'コーヒー', is_primary: 1, no_kanji: 1, romaji: 'koohii' }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: '東京', is_primary: 1 }],
      readings: [{ text: 'とうきょう', is_primary: 1, romaji: 'toukyou' }]
    });
    seedEntry({
      id: 3,
      is_common: 1,
      spellings: [{ text: '寿司', is_primary: 1 }],
      readings: [{ text: 'すし', is_primary: 1, romaji: 'sushi' }]
    });
    seedEntry({
      id: 4,
      is_common: 1,
      spellings: [{ text: 'ラーメン', is_primary: 1 }],
      readings: [{ text: 'ラーメン', is_primary: 1, no_kanji: 1, romaji: 'raamen' }]
    });
    seedEntry({
      id: 5,
      is_common: 1,
      spellings: [{ text: '新聞', is_primary: 1 }],
      readings: [{ text: 'しんぶん', is_primary: 1, romaji: 'shinbun' }]
    });

    for (const [query, entryId] of [
      ['koohii', 1],
      ['toukyou', 2],
      ['sushi', 3]
    ] as const) {
      const res = await app.inject({ method: 'GET', url: `/dictionary/search?q=${query}` });
      const results = parseSearchMatches(res.body);
      const hit = results.find((r) => r.entry_id === entryId);
      expect(hit?.match_type, `expected ${query} to match entry ${entryId}`).toBe('exact_reading');
    }

    for (const query of ['kohi', 'tokyo', 'susi', 'ramen', 'shimbun']) {
      const res = await app.inject({ method: 'GET', url: `/dictionary/search?q=${query}` });
      const body = JSON.parse(res.body) as { results: Array<{ entry_id: number }> };
      expect(body.results, `expected ${query} to match nothing`).toEqual([]);
    }
  });

  it('collapses じ and ぢ onto the same romaji (ji)', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: '痔', is_primary: 1 }],
      readings: [{ text: 'じ', is_primary: 1, romaji: 'ji' }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: '地', is_primary: 1 }],
      readings: [{ text: 'ぢ', is_primary: 1, romaji: 'ji' }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=ji' });

    expect(res.statusCode).toBe(200);
    const results = parseSearchMatches(res.body);
    expect(results.map((r) => [r.entry_id, r.match_type])).toEqual([
      [1, 'exact_reading'],
      [2, 'exact_reading']
    ]);
  });

  it('collapses ず and づ onto the same romaji (zu)', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: '図', is_primary: 1 }],
      readings: [{ text: 'ず', is_primary: 1, romaji: 'zu' }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: '鈴', is_primary: 1 }],
      readings: [{ text: 'づ', is_primary: 1, romaji: 'zu' }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=zu' });

    expect(res.statusCode).toBe(200);
    const results = parseSearchMatches(res.body);
    expect(results.map((r) => [r.entry_id, r.match_type])).toEqual([
      [1, 'exact_reading'],
      [2, 'exact_reading']
    ]);
  });

  it('leaves a reading whose romaji is NULL unmatched without crashing', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: 'ぬる', is_primary: 1 }],
      readings: [{ text: 'ぬる', is_primary: 1, romaji: null }]
    });

    const res = await app.inject({ method: 'GET', url: '/dictionary/search?q=nuru' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { results: Array<{ entry_id: number }> };
    expect(body.results).toEqual([]);
  });
});

describe('GET /dictionary/search — romaji query cleaning (ADR 0011)', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  /** One entry per cleaning rule: case folding, apostrophes, macrons, strictness. */
  function seedCleaningEntries(): void {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: '食べる', is_primary: 1 }],
      readings: [{ text: 'たべる', is_primary: 1, romaji: 'taberu' }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: '東京', is_primary: 1 }],
      readings: [{ text: 'とうきょう', is_primary: 1, romaji: 'toukyou' }]
    });
    seedEntry({
      id: 3,
      is_common: 1,
      spellings: [{ text: '新一', is_primary: 1 }],
      readings: [{ text: 'しんいち', is_primary: 1, romaji: 'shinichi' }]
    });
    seedEntry({
      id: 4,
      is_common: 1,
      spellings: [{ text: '先生', is_primary: 1 }],
      readings: [{ text: 'せんせい', is_primary: 1, romaji: 'sensei' }]
    });
    seedEntry({
      id: 5,
      is_common: 1,
      spellings: [{ text: '勇気', is_primary: 1 }],
      readings: [{ text: 'ゆうき', is_primary: 1, romaji: 'yuuki' }]
    });
    seedEntry({
      id: 6,
      is_common: 1,
      spellings: [{ text: 'コーヒー', is_primary: 1 }],
      readings: [{ text: 'コーヒー', is_primary: 1, no_kanji: 1, romaji: 'koohii' }]
    });
  }

  it('lowercase-folds uppercase and mixed-case queries', async () => {
    seedCleaningEntries();

    for (const query of ['TABERU', 'Taberu']) {
      const res = await search(query);

      expect(res.statusCode).toBe(200);
      expect(
        parseSearchMatches(res.body).map((r) => [r.entry_id, r.match_type]),
        query
      ).toEqual([[1, 'exact_reading']]);
    }
  });

  it('expands macrons to the stored literal kana-sequence vowels', async () => {
    seedCleaningEntries();

    for (const [query, entryId] of [
      ['Tōkyō', 2],
      ['sensē', 4],
      ['yūki', 5]
    ] as const) {
      const res = await search(query);

      expect(res.statusCode).toBe(200);
      expect(
        parseSearchMatches(res.body).map((r) => [r.entry_id, r.match_type]),
        query
      ).toEqual([[entryId, 'exact_reading']]);
    }
  });

  it("strips ASCII and typographic apostrophes (shin'ichi → shinichi)", async () => {
    seedCleaningEntries();

    for (const query of ["shin'ichi", 'shin’ichi']) {
      const res = await search(query);

      expect(res.statusCode).toBe(200);
      expect(
        parseSearchMatches(res.body).map((r) => [r.entry_id, r.match_type]),
        query
      ).toEqual([[3, 'exact_reading']]);
    }
  });

  it('cleans the query in prefix mode too (Tōky → 東京)', async () => {
    seedCleaningEntries();

    const res = await search('Tōky');

    expect(res.statusCode).toBe(200);
    expect(parseSearchMatches(res.body).map((r) => [r.entry_id, r.match_type])).toEqual([
      [2, 'prefix_reading']
    ]);
  });

  it('stays strict: non-stored forms (tokyo, kohi) return no results', async () => {
    seedCleaningEntries();

    for (const query of ['tokyo', 'kohi']) {
      const res = await search(query);

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { results: Array<{ entry_id: number }> };
      expect(body.results, query).toEqual([]);
    }
  });

  it('leaves kana and spelling search unaffected', async () => {
    seedCleaningEntries();

    const kanaRes = await search('とうきょう');
    expect(kanaRes.statusCode).toBe(200);
    expect(parseSearchMatches(kanaRes.body).map((r) => [r.entry_id, r.match_type])).toEqual([
      [2, 'exact_reading']
    ]);

    const spellingRes = await search('東京');
    expect(spellingRes.statusCode).toBe(200);
    expect(parseSearchMatches(spellingRes.body).map((r) => [r.entry_id, r.match_type])).toEqual([
      [2, 'exact_spelling']
    ]);
  });

  it('returns no results when cleaning reduces the query to nothing', async () => {
    seedCleaningEntries();

    const res = await search("'");

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { results: Array<{ entry_id: number }> };
    expect(body.results).toEqual([]);
  });
});

describe('GET /dictionary/search — particle alternates (ADR 0011)', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('finds readings whose particles are stored kana-literally', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: '今日は', is_primary: 1 }],
      readings: [{ text: 'こんにちは', is_primary: 1, romaji: 'konnichiha' }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: 'では', is_primary: 1 }],
      readings: [{ text: 'では', is_primary: 1, romaji: 'deha' }]
    });
    seedEntry({
      id: 3,
      is_common: 1,
      spellings: [{ text: 'せざるを得ない', is_primary: 1 }],
      readings: [{ text: 'せざるをえない', is_primary: 1, romaji: 'sezaruoenai' }]
    });
    seedEntry({
      id: 4,
      is_common: 1,
      spellings: [{ text: '嘘をつく', is_primary: 1 }],
      readings: [{ text: 'うそをつく', is_primary: 1, romaji: 'usootsuku' }]
    });
    seedEntry({
      id: 5,
      is_common: 1,
      spellings: [{ text: '何方へ', is_primary: 1 }],
      readings: [{ text: 'どちらへ', is_primary: 1, romaji: 'dochirahe' }]
    });
    seedEntry({
      id: 6,
      is_common: 1,
      spellings: [{ text: '所へ', is_primary: 1 }],
      readings: [{ text: 'ところへ', is_primary: 1, romaji: 'tokorohe' }]
    });
    seedEntry({
      id: 7,
      is_common: 1,
      spellings: [{ text: '元へ', is_primary: 1 }],
      readings: [{ text: 'もとへ', is_primary: 1, romaji: 'motohe' }]
    });

    for (const [query, entryId] of [
      ['konnichiwa', 1],
      ['dewa', 2],
      ['sezaruwoenai', 3],
      ['usowotsuku', 4],
      ['dochirae', 5],
      ['tokoroe', 6],
      ['motoe', 7]
    ] as const) {
      const res = await search(query);

      expect(res.statusCode, query).toBe(200);
      expect(
        parseSearchMatches(res.body).map((r) => [r.entry_id, r.match_type]),
        query
      ).toEqual([[entryId, 'exact_reading']]);
    }
  });

  it('combines the wa→ha and e→he substitutions in one query', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: 'では所へ', is_primary: 1 }],
      readings: [{ text: 'ではところへ', is_primary: 1, romaji: 'dehatokorohe' }]
    });

    const res = await search('dewatokoroe');

    expect(res.statusCode).toBe(200);
    expect(parseSearchMatches(res.body).map((r) => [r.entry_id, r.match_type])).toEqual([
      [1, 'exact_reading']
    ]);
  });

  it('keeps wa→ha even when the query is itself a stored reading (出羽 dewa finds では)', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: '出羽', is_primary: 1 }],
      readings: [{ text: 'でわ', is_primary: 1, romaji: 'dewa' }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: 'では', is_primary: 1 }],
      readings: [{ text: 'では', is_primary: 1, romaji: 'deha' }]
    });

    const res = await search('dewa');

    expect(res.statusCode).toBe(200);
    expect(parseSearchMatches(res.body).map((r) => [r.entry_id, r.match_type])).toEqual([
      [1, 'exact_reading'],
      [2, 'exact_reading']
    ]);
  });

  it('never substitutes word-initial particles, so lookalike readings stay unmatched', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: 'わかる', is_primary: 1 }],
      readings: [{ text: 'わかる', is_primary: 1, romaji: 'wakaru' }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: '笑う', is_primary: 1 }],
      readings: [{ text: 'わらう', is_primary: 1, romaji: 'warau' }]
    });
    // Would-be `ha%` strays if a word-initial wa were substituted.
    seedEntry({
      id: 3,
      is_common: 1,
      spellings: [{ text: '測る', is_primary: 1 }],
      readings: [{ text: 'はかる', is_primary: 1, romaji: 'hakaru' }]
    });
    seedEntry({
      id: 4,
      is_common: 1,
      spellings: [{ text: '払う', is_primary: 1 }],
      readings: [{ text: 'はらう', is_primary: 1, romaji: 'harau' }]
    });
    // Standalone non-initial e lookalikes: each query below is itself an exact
    // stored reading, so its final e is treated as part of the word and the
    // e→he alternate is suppressed — the decoys further down stay unmatched.
    seedEntry({
      id: 5,
      is_common: 1,
      spellings: [{ text: 'かわいい', is_primary: 1 }],
      readings: [{ text: 'かわいい', is_primary: 1, romaji: 'kawaii' }]
    });
    seedEntry({
      id: 6,
      is_common: 1,
      spellings: [{ text: '家', is_primary: 1 }],
      readings: [{ text: 'いえ', is_primary: 1, romaji: 'ie' }]
    });
    seedEntry({
      id: 7,
      is_common: 1,
      spellings: [{ text: '上', is_primary: 1 }],
      readings: [{ text: 'うえ', is_primary: 1, romaji: 'ue' }]
    });
    seedEntry({
      id: 8,
      is_common: 1,
      spellings: [{ text: '声', is_primary: 1 }],
      readings: [{ text: 'こえ', is_primary: 1, romaji: 'koe' }]
    });
    seedEntry({
      id: 9,
      is_common: 1,
      spellings: [{ text: '前', is_primary: 1 }],
      readings: [{ text: 'まえ', is_primary: 1, romaji: 'mae' }]
    });
    // Would-be he% strays if the e→he alternate fired for ie/ue/koe/mae.
    seedEntry({
      id: 10,
      is_common: 1,
      spellings: [{ text: '異変', is_primary: 1 }],
      readings: [{ text: 'いへん', is_primary: 1, romaji: 'ihen' }]
    });
    seedEntry({
      id: 11,
      is_common: 1,
      spellings: [{ text: 'うへっ', is_primary: 1 }],
      readings: [{ text: 'うへっ', is_primary: 1, romaji: 'uhe' }]
    });
    seedEntry({
      id: 12,
      is_common: 1,
      spellings: [{ text: 'こへい', is_primary: 1 }],
      readings: [{ text: 'こへい', is_primary: 1, romaji: 'kohei' }]
    });
    seedEntry({
      id: 13,
      is_common: 1,
      spellings: [{ text: 'まへん', is_primary: 1 }],
      readings: [{ text: 'まへん', is_primary: 1, romaji: 'mahen' }]
    });

    for (const [query, entryId] of [
      ['wakaru', 1],
      ['warau', 2],
      ['kawaii', 5],
      ['ie', 6],
      ['ue', 7],
      ['koe', 8],
      ['mae', 9]
    ] as const) {
      const res = await search(query);

      expect(res.statusCode, query).toBe(200);
      expect(
        parseSearchMatches(res.body).map((r) => [r.entry_id, r.match_type]),
        query
      ).toEqual([[entryId, 'exact_reading']]);
    }
  });

  it('tries a whole-query wa/wo/e alternate for exact matching only', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: 'わ', is_primary: 1 }],
      readings: [{ text: 'わ', is_primary: 1, romaji: 'wa' }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: 'は', is_primary: 1 }],
      readings: [{ text: 'は', is_primary: 1, romaji: 'ha' }]
    });
    seedEntry({
      id: 3,
      is_common: 1,
      spellings: [{ text: 'はし', is_primary: 1 }],
      readings: [{ text: 'はし', is_primary: 1, romaji: 'hashi' }]
    });
    seedEntry({
      id: 4,
      is_common: 1,
      spellings: [{ text: 'を', is_primary: 1 }],
      readings: [{ text: 'を', is_primary: 1, romaji: 'o' }]
    });
    seedEntry({
      id: 5,
      is_common: 1,
      spellings: [{ text: 'おば', is_primary: 1 }],
      readings: [{ text: 'おば', is_primary: 1, romaji: 'oba' }]
    });
    seedEntry({
      id: 6,
      is_common: 1,
      spellings: [{ text: 'へ', is_primary: 1 }],
      readings: [{ text: 'へ', is_primary: 1, romaji: 'he' }]
    });
    seedEntry({
      id: 7,
      is_common: 1,
      spellings: [{ text: 'へや', is_primary: 1 }],
      readings: [{ text: 'へや', is_primary: 1, romaji: 'heya' }]
    });

    // wa: the clean exact match plus the ha alternate exact match, but はし
    // (hashi) must not be hit by a ha% prefix scan.
    const waRes = await search('wa');
    expect(waRes.statusCode).toBe(200);
    expect(parseSearchMatches(waRes.body).map((r) => [r.entry_id, r.match_type])).toEqual([
      [1, 'exact_reading'],
      [2, 'exact_reading']
    ]);

    // wo: を stores as o, and the exact-only alternate must not scan おば (oba).
    const woRes = await search('wo');
    expect(woRes.statusCode).toBe(200);
    expect(parseSearchMatches(woRes.body).map((r) => [r.entry_id, r.match_type])).toEqual([
      [4, 'exact_reading']
    ]);

    // e: the clean e% prefix scan finds nothing, and the he alternate must not
    // scan へや (heya).
    const eRes = await search('e');
    expect(eRes.statusCode).toBe(200);
    expect(parseSearchMatches(eRes.body).map((r) => [r.entry_id, r.match_type])).toEqual([
      [6, 'exact_reading']
    ]);
  });

  it('ranks an alternate exact match above an alternate prefix match', async () => {
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: '今日は', is_primary: 1 }],
      readings: [{ text: 'こんにちは', is_primary: 1, romaji: 'konnichiha' }]
    });
    seedEntry({
      id: 2,
      is_common: 1,
      spellings: [{ text: '今日はな', is_primary: 1 }],
      readings: [{ text: 'こんにちはな', is_primary: 1, romaji: 'konnichihana' }]
    });

    const res = await search('konnichiwa');

    expect(res.statusCode).toBe(200);
    expect(parseSearchMatches(res.body).map((r) => [r.entry_id, r.match_type])).toEqual([
      [1, 'exact_reading'],
      [2, 'prefix_reading']
    ]);
  });
});

describe('GET /dictionary/search — LIKE wildcards are literal', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
    seedEntry({
      id: 1,
      is_common: 1,
      spellings: [{ text: '食べる', is_primary: 1 }],
      readings: [{ text: 'たべる', is_primary: 1, romaji: 'taberu' }]
    });
  });

  async function expectNoResults(query: string): Promise<void> {
    const res = await search(query);

    expect(res.statusCode, query).toBe(200);
    const body = JSON.parse(res.body) as { results: Array<{ entry_id: number }> };
    expect(body.results, query).toEqual([]);
  }

  it('treats _ as a literal, not a single-character wildcard (t_beru does not match taberu)', async () => {
    await expectNoResults('t_beru');
  });

  it('treats % as a literal, not a prefix wildcard (tabe% does not match taberu)', async () => {
    await expectNoResults('tabe%');
  });

  it('still matches romaji prefixes when no wildcard characters are present', async () => {
    const res = await search('tabe');

    expect(res.statusCode).toBe(200);
    expect(parseSearchMatches(res.body).map((r) => [r.entry_id, r.match_type])).toEqual([
      [1, 'prefix_reading']
    ]);
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
