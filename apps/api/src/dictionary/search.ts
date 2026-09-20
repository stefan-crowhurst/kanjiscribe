import {
  foldReadingToHiragana,
  foldReadingToKatakana,
  stringArraySchema,
  type DictionaryMatchType,
  type DictionarySearchResult
} from '@kanjiscribe/shared';

import { todayIsoDate } from '../config.js';
import { sqlite } from '../db/client.js';
import { cleanRomajiQuery, romajiQueryVariants } from './romaji-query.js';

const MATCH_PRIORITY: Record<DictionaryMatchType, number> = {
  exact_spelling: 0,
  exact_reading: 1,
  prefix_spelling: 2,
  prefix_reading: 3
};

type Strategy = { type: DictionaryMatchType; sql: string; value: string };

type SearchColumn = { table: string; column: string };

const SPELLING_TEXT: SearchColumn = { table: 'entry_spelling', column: 'text' };
const READING_TEXT: SearchColumn = { table: 'entry_reading', column: 'text' };
const READING_ROMAJI: SearchColumn = { table: 'entry_reading', column: 'romaji' };

/**
 * Escapes LIKE metacharacters so `%`/`_` in a romaji query match literally,
 * not as wildcards. Only romaji strategies escape — spelling/kana deliberately
 * keep their pre-existing wildcard semantics.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function exactStrategy(column: SearchColumn, type: DictionaryMatchType, value: string): Strategy {
  return {
    type,
    sql: `SELECT DISTINCT entry_id FROM ${column.table} WHERE ${column.column} = ? LIMIT 50`,
    value
  };
}

/**
 * Prefix match that keeps raw LIKE wildcard semantics (`%`/`_` act as
 * wildcards) for spelling and kana queries; romaji uses
 * `escapedPrefixStrategy` instead.
 */
function prefixStrategy(column: SearchColumn, type: DictionaryMatchType, value: string): Strategy {
  return {
    type,
    sql: `SELECT DISTINCT entry_id FROM ${column.table} WHERE ${column.column} LIKE ? LIMIT 50`,
    value: `${value}%`
  };
}

function escapedPrefixStrategy(
  column: SearchColumn,
  type: DictionaryMatchType,
  value: string
): Strategy {
  return {
    type,
    sql: `SELECT DISTINCT entry_id FROM ${column.table} WHERE ${column.column} LIKE ? ESCAPE '\\' LIMIT 50`,
    value: `${escapeLike(value)}%`
  };
}

export function searchDictionary(query: string): DictionarySearchResult[] {
  const today = todayIsoDate();
  const matches = new Map<number, DictionaryMatchType>();

  const strategies: Strategy[] = [
    exactStrategy(SPELLING_TEXT, 'exact_spelling', query),
    prefixStrategy(SPELLING_TEXT, 'prefix_spelling', query)
  ];

  // Reading queries are script-insensitive (ADR 0010): the raw query plus the
  // query folded to hiragana and to katakana are all matched, and the best
  // match type across the query forms wins. The raw query is included so
  // mixed-script readings (e.g. バカな), which fold to neither pure script,
  // keep matching their own stored form.
  const queryFolds = Array.from(
    new Set([query, foldReadingToHiragana(query), foldReadingToKatakana(query)])
  );
  for (const queryFold of queryFolds) {
    strategies.push(exactStrategy(READING_TEXT, 'exact_reading', queryFold));
    strategies.push(prefixStrategy(READING_TEXT, 'prefix_reading', queryFold));
  }

  // Romaji queries (ADR 0011) match the stored Romaji form using cleaned and
  // particle-alternate variants; a whole-query `wa`/`wo`/`e` alternate is
  // exact-only so it cannot become a `ha%` prefix scan. The `e`→`he` alternate
  // is skipped when the query is itself an exact stored reading (ie/ue/koe/mae
  // stay words), while `wa`→`ha` never is — `dewa` must still find では.
  const cleanedRomaji = cleanRomajiQuery(query);
  const cleanedIsStoredReading =
    cleanedRomaji !== '' &&
    sqlite.prepare('SELECT 1 FROM entry_reading WHERE romaji = ? LIMIT 1').get(cleanedRomaji) !==
      undefined;
  for (const variant of romajiQueryVariants(query, {
    exactStoredReading: cleanedIsStoredReading
  })) {
    strategies.push(exactStrategy(READING_ROMAJI, 'exact_reading', variant.value));
    if (!variant.exactOnly) {
      strategies.push(escapedPrefixStrategy(READING_ROMAJI, 'prefix_reading', variant.value));
    }
  }

  for (const strategy of strategies) {
    const rows = sqlite.prepare(strategy.sql).all(strategy.value) as Array<{ entry_id: number }>;
    for (const row of rows) {
      const existing = matches.get(row.entry_id);
      if (!existing || MATCH_PRIORITY[strategy.type] < MATCH_PRIORITY[existing]) {
        matches.set(row.entry_id, strategy.type);
      }
    }
  }

  const ids = Array.from(matches.keys());
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(', ');
  const baseRows = sqlite
    .prepare(
      `
      SELECT
        de.id,
        de.is_common,
        de.priority_rank,
        (
          SELECT text
          FROM entry_spelling es
          WHERE es.entry_id = de.id
          ORDER BY is_primary DESC, text ASC
          LIMIT 1
        ) AS primary_spelling,
        (
          SELECT text
          FROM entry_reading er
          WHERE er.entry_id = de.id
          ORDER BY is_primary DESC, text ASC
          LIMIT 1
        ) AS primary_reading,
        (
          SELECT glosses_json
          FROM entry_sense se
          WHERE se.entry_id = de.id
          ORDER BY sense_index ASC
          LIMIT 1
        ) AS first_glosses_json,
        (
          SELECT COUNT(*)
          FROM daily_assignment da
          JOIN study_item si ON si.id = da.study_item_id
          WHERE
            si.dictionary_entry_id = de.id
            AND da.assigned_for_date = ?
            AND da.status != 'archived'
        ) AS today_assigned_count
      FROM dictionary_entry de
      WHERE de.id IN (${placeholders})
      `
    )
    .all(today, ...ids) as Array<{
    id: number;
    is_common: number;
    priority_rank: number | null;
    primary_spelling: string | null;
    primary_reading: string | null;
    first_glosses_json: string | null;
    today_assigned_count: number;
  }>;

  const spellings = sqlite
    .prepare(
      `
      SELECT entry_id, text, is_primary
      FROM entry_spelling
      WHERE entry_id IN (${placeholders})
      ORDER BY is_primary DESC, text ASC
      `
    )
    .all(...ids) as Array<{ entry_id: number; text: string; is_primary: number }>;

  const readings = sqlite
    .prepare(
      `
      SELECT entry_id, text, no_kanji
      FROM entry_reading
      WHERE entry_id IN (${placeholders})
      ORDER BY is_primary DESC, text ASC
      `
    )
    .all(...ids) as Array<{ entry_id: number; text: string; no_kanji: number }>;

  const spellingsByEntry = new Map<number, Array<{ text: string; is_primary: boolean }>>();
  const readingsByEntry = new Map<number, Array<{ text: string; no_kanji: boolean }>>();

  for (const row of spellings) {
    const current = spellingsByEntry.get(row.entry_id) ?? [];
    current.push({ text: row.text, is_primary: Boolean(row.is_primary) });
    spellingsByEntry.set(row.entry_id, current);
  }

  for (const row of readings) {
    const current = readingsByEntry.get(row.entry_id) ?? [];
    current.push({ text: row.text, no_kanji: Boolean(row.no_kanji) });
    readingsByEntry.set(row.entry_id, current);
  }

  return baseRows
    .map((row) => {
      const glosses = stringArraySchema.parse(row.first_glosses_json).slice(0, 5);
      return {
        entry_id: row.id,
        primary_spelling: row.primary_spelling,
        primary_reading: row.primary_reading,
        glosses,
        is_common: Boolean(row.is_common),
        readings: readingsByEntry.get(row.id) ?? [],
        spellings: spellingsByEntry.get(row.id) ?? [],
        priority_rank: row.priority_rank,
        today_assigned: row.today_assigned_count > 0,
        match_type: matches.get(row.id) ?? 'prefix_reading'
      };
    })
    .sort((a, b) => {
      const matchDiff = MATCH_PRIORITY[a.match_type] - MATCH_PRIORITY[b.match_type];
      if (matchDiff !== 0) {
        return matchDiff;
      }
      if (a.is_common !== b.is_common) {
        return a.is_common ? -1 : 1;
      }
      const aRank = a.priority_rank ?? Number.MAX_SAFE_INTEGER;
      const bRank = b.priority_rank ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    })
    .slice(0, 50)
    .map(({ priority_rank: _priorityRank, ...result }) => result);
}
