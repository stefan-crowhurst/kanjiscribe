import type { DictionaryMatchType, DictionarySearchResult } from '@kanjiscribe/shared';

import { todayIsoDate } from '../config.js';
import { sqlite } from '../db/client.js';
import { safeJsonParse } from '../http.js';

const MATCH_PRIORITY: Record<DictionaryMatchType, number> = {
  exact_spelling: 0,
  exact_reading: 1,
  prefix_spelling: 2,
  prefix_reading: 3
};

export function searchDictionary(query: string): DictionarySearchResult[] {
  const today = todayIsoDate();
  const matches = new Map<number, DictionaryMatchType>();

  const strategies: Array<{ type: DictionaryMatchType; sql: string; value: string }> = [
    {
      type: 'exact_spelling',
      sql: `SELECT DISTINCT entry_id FROM entry_spelling WHERE text = ? LIMIT 50`,
      value: query
    },
    {
      type: 'exact_reading',
      sql: `SELECT DISTINCT entry_id FROM entry_reading WHERE text = ? LIMIT 50`,
      value: query
    },
    {
      type: 'prefix_spelling',
      sql: `SELECT DISTINCT entry_id FROM entry_spelling WHERE text LIKE ? LIMIT 50`,
      value: `${query}%`
    },
    {
      type: 'prefix_reading',
      sql: `SELECT DISTINCT entry_id FROM entry_reading WHERE text LIKE ? LIMIT 50`,
      value: `${query}%`
    }
  ];

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
      const glosses = safeJsonParse<string[]>(row.first_glosses_json).slice(0, 5);
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
