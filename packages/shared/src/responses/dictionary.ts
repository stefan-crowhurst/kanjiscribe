import { z } from 'zod';

import { DICTIONARY_MATCH_TYPES } from '../enums.js';

/**
 * Dictionary search result — one hit of `GET /dictionary/search`: the entry's
 * primary spelling/reading, the first five glosses, all spellings and
 * readings, the `match_type` tier, and whether a non-archived assignment
 * exists for the entry today (`today_assigned`).
 */
export const dictionarySearchResultSchema = z.object({
  entry_id: z.number().int().positive(),
  primary_spelling: z.string().nullable(),
  primary_reading: z.string().nullable(),
  glosses: z.array(z.string()),
  is_common: z.boolean(),
  readings: z.array(
    z.object({
      text: z.string(),
      no_kanji: z.boolean()
    })
  ),
  spellings: z.array(
    z.object({
      text: z.string(),
      is_primary: z.boolean()
    })
  ),
  today_assigned: z.boolean(),
  match_type: z.enum(DICTIONARY_MATCH_TYPES)
});

export type DictionarySearchResult = z.infer<typeof dictionarySearchResultSchema>;

export const dictionarySearchResponseSchema = z.object({
  results: z.array(dictionarySearchResultSchema)
});

export type DictionarySearchResponse = z.infer<typeof dictionarySearchResponseSchema>;

/**
 * Dictionary entry detail — the full entry returned by
 * `GET /dictionary/entries/:id`: every spelling/reading with its priority and
 * kanji flags, all senses (glosses, parts of speech, and the tag/notes
 * arrays), and the reading↔spelling restriction pairs.
 */
export const dictionaryEntryDetailSchema = z.object({
  id: z.number().int().positive(),
  is_common: z.boolean(),
  priority_rank: z.number().int().positive().nullable(),
  spellings: z.array(
    z.object({
      text: z.string(),
      is_primary: z.boolean(),
      priority_rank: z.number().int().positive().nullable()
    })
  ),
  readings: z.array(
    z.object({
      text: z.string(),
      is_primary: z.boolean(),
      no_kanji: z.boolean()
    })
  ),
  senses: z.array(
    z.object({
      sense_index: z.number().int().min(0),
      glosses: z.array(z.string()),
      parts_of_speech: z.array(z.string()),
      misc_tags: z.array(z.string()),
      field_tags: z.array(z.string()),
      dialect_tags: z.array(z.string()),
      info: z.array(z.string())
    })
  ),
  reading_restrictions: z.array(
    z.object({
      reading_text: z.string(),
      spelling_text: z.string()
    })
  )
});

export type DictionaryEntryDetail = z.infer<typeof dictionaryEntryDetailSchema>;

export const dictionaryEntryDetailResponseSchema = z.object({
  entry: dictionaryEntryDetailSchema
});

export type DictionaryEntryDetailResponse = z.infer<typeof dictionaryEntryDetailResponseSchema>;
