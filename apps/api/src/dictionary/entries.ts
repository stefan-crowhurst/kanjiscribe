import type { DictionaryEntryDetail } from '@kanjiscribe/shared';

import { sqlite } from '../db/client.js';
import { safeJsonParse } from '../util.js';

export function getEntryDetails(entryId: number): DictionaryEntryDetail | null {
  const entry = sqlite
    .prepare(
      `
      SELECT id, is_common, priority_rank
      FROM dictionary_entry
      WHERE id = ?
      `
    )
    .get(entryId) as { id: number; is_common: number; priority_rank: number | null } | undefined;

  if (!entry) {
    return null;
  }

  const spellings = sqlite
    .prepare(
      `
      SELECT text, is_primary, priority_rank
      FROM entry_spelling
      WHERE entry_id = ?
      ORDER BY is_primary DESC, text ASC
      `
    )
    .all(entryId) as Array<{ text: string; is_primary: number; priority_rank: number | null }>;

  const readings = sqlite
    .prepare(
      `
      SELECT text, is_primary, no_kanji
      FROM entry_reading
      WHERE entry_id = ?
      ORDER BY is_primary DESC, text ASC
      `
    )
    .all(entryId) as Array<{ text: string; is_primary: number; no_kanji: number }>;

  const senses = sqlite
    .prepare(
      `
      SELECT
        sense_index,
        glosses_json,
        parts_of_speech_json,
        misc_tags_json,
        field_tags_json,
        dialect_tags_json,
        info_json
      FROM entry_sense
      WHERE entry_id = ?
      ORDER BY sense_index ASC
      `
    )
    .all(entryId) as Array<{
    sense_index: number;
    glosses_json: string;
    parts_of_speech_json: string;
    misc_tags_json: string;
    field_tags_json: string;
    dialect_tags_json: string;
    info_json: string;
  }>;

  const readingRestrictions = sqlite
    .prepare(
      `
      SELECT reading_text, spelling_text
      FROM entry_reading_spelling
      WHERE entry_id = ?
      ORDER BY reading_text ASC, spelling_text ASC
      `
    )
    .all(entryId) as Array<{ reading_text: string; spelling_text: string }>;

  return {
    id: entry.id,
    is_common: Boolean(entry.is_common),
    priority_rank: entry.priority_rank,
    spellings: spellings.map((item) => ({
      text: item.text,
      is_primary: Boolean(item.is_primary),
      priority_rank: item.priority_rank
    })),
    readings: readings.map((item) => ({
      text: item.text,
      is_primary: Boolean(item.is_primary),
      no_kanji: Boolean(item.no_kanji)
    })),
    senses: senses.map((sense) => ({
      sense_index: sense.sense_index,
      glosses: safeJsonParse<string[]>(sense.glosses_json),
      parts_of_speech: safeJsonParse<string[]>(sense.parts_of_speech_json),
      misc_tags: safeJsonParse<string[]>(sense.misc_tags_json),
      field_tags: safeJsonParse<string[]>(sense.field_tags_json),
      dialect_tags: safeJsonParse<string[]>(sense.dialect_tags_json),
      info: safeJsonParse<string[]>(sense.info_json)
    })),
    reading_restrictions: readingRestrictions
  };
}
