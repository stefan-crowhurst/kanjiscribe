import type { Database } from 'better-sqlite3';

import { sqlite } from './db/client.js';

export type SeededAssignment = {
  id: number;
  study_item_id: number;
  assigned_for_date: string;
  status: 'pending' | 'completed' | 'skipped' | 'archived';
};

function wipeAll(db: Database): void {
  db.exec('PRAGMA foreign_keys = OFF');
  for (const table of [
    'kanji_attribution',
    'daily_assignment',
    'study_item',
    'study_item_kanji',
    'dictionary_entry',
    'entry_spelling',
    'entry_reading',
    'entry_reading_spelling',
    'entry_sense',
    'kanji',
    'kanji_stroke_asset',
    'study_session',
    'study_event',
    'importer_run',
    'app_config'
  ]) {
    db.exec(`DELETE FROM ${table};`);
  }
  db.exec('PRAGMA foreign_keys = ON');
}

export function resetDb(): void {
  const dbPath = process.env.KANJISCRIBE_DB_PATH ?? '';
  if (!dbPath.includes('kanjiscribe-test')) {
    throw new Error(
      `resetDb() refused to wipe non-test database: "${dbPath}". ` +
        'Set KANJISCRIBE_DB_PATH to a path containing "kanjiscribe-test" before running tests.'
    );
  }
  wipeAll(sqlite);
}

let nextStudyItemId = 1;
let nextAssignmentId = 1;

export function seedKanji(literal: string, strokeCount: number, db: Database = sqlite): void {
  db.prepare(
    `INSERT INTO kanji (literal, meanings_json, onyomi_json, kunyomi_json, stroke_count, grade, jlpt_level, frequency_rank)
     VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)
     ON CONFLICT(literal) DO UPDATE SET stroke_count = excluded.stroke_count`
  ).run(literal, JSON.stringify([]), JSON.stringify([]), JSON.stringify([]), strokeCount);
}

export function seedStudyItem(
  db: Database = sqlite,
  dictId: number = 1,
  overrides?: { surface_form?: string; selected_reading?: string }
): number {
  const ts = '2024-01-01T00:00:00.000Z';
  db.prepare(
    `INSERT INTO dictionary_entry (id, is_common, priority_rank, created_at, updated_at) VALUES (?, 1, NULL, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).run(dictId, ts, ts);

  const studyItemId = nextStudyItemId++;
  const surfaceForm = overrides?.surface_form ?? `形${studyItemId}`;
  const selectedReading = overrides?.selected_reading ?? `よみ${studyItemId}`;
  db.prepare(
    `INSERT INTO study_item (id, surface_form, selected_reading, dictionary_entry_id, source_type, created_at)
     VALUES (?, ?, ?, ?, 'manual', ?)`
  ).run(studyItemId, surfaceForm, selectedReading, dictId, ts);
  return studyItemId;
}

export function seedStudyItemKanji(
  studyItemId: number,
  kanji: Array<{ position: number; literal: string }>,
  db: Database = sqlite
): void {
  const insert = db.prepare(
    `INSERT INTO study_item_kanji (study_item_id, position, kanji_literal)
     VALUES (?, ?, ?)
     ON CONFLICT(study_item_id, position) DO UPDATE SET kanji_literal = excluded.kanji_literal`
  );
  for (const { position, literal } of kanji) {
    insert.run(studyItemId, position, literal);
  }
}

export function seedAssignment(
  opts: {
    study_item_id: number;
    assigned_for_date?: string;
    status?: 'pending' | 'completed' | 'skipped' | 'archived';
    time_spent_ms?: number | null;
    /**
     * Optional estimate-snapshot value to write into `estimated_ms`. Omit
     * (or pass `null`) to seed a legacy-style row with a NULL snapshot —
     * used to model pre-feature rows under SUM estimate semantics.
     */
    estimated_ms?: number | null;
    queue_position?: number | null;
  },
  db: Database = sqlite
): SeededAssignment {
  const ts = '2024-01-01T00:00:00.000Z';
  const id = nextAssignmentId++;
  const date = opts.assigned_for_date ?? '2024-01-01';
  const status = opts.status ?? 'pending';
  const completedAt = status === 'completed' ? ts : null;

  db.prepare(
    `INSERT INTO daily_assignment (id, study_item_id, assigned_for_date, status, origin, time_spent_ms, created_at, completed_at, estimated_ms, queue_position)
     VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?)`
  ).run(
    id,
    opts.study_item_id,
    date,
    status,
    opts.time_spent_ms ?? null,
    ts,
    completedAt,
    opts.estimated_ms ?? null,
    opts.queue_position ?? null
  );

  return { id, study_item_id: opts.study_item_id, assigned_for_date: date, status };
}

export function assignmentStatus(id: number, db: Database = sqlite): string | undefined {
  const row = db.prepare(`SELECT status FROM daily_assignment WHERE id = ?`).get(id) as
    | { status: string }
    | undefined;
  return row?.status;
}

export function resetCounters(): void {
  nextStudyItemId = 1;
  nextAssignmentId = 1;
}

export type SeedSpelling = { text: string; is_primary?: number; priority_rank?: number | null };
export type SeedReading = {
  text: string;
  is_primary?: number;
  no_kanji?: number;
  /**
   * The reading's stored Romaji form as an explicit literal; omit (NULL) when
   * the test doesn't exercise romaji search, so fixtures never depend on the
   * production converter. Converter rules are pinned by
   * `packages/shared/src/romaji.test.ts` and the importer test.
   */
  romaji?: string | null;
};
export type SeedSense = {
  sense_index: number;
  glosses_json?: string;
  parts_of_speech_json?: string;
  misc_tags_json?: string;
  field_tags_json?: string;
  dialect_tags_json?: string;
  info_json?: string;
};

export type SeedReadingRestriction = {
  reading_text: string;
  spelling_text: string;
};

export type SeedEntryOptions = {
  id: number;
  is_common?: number;
  priority_rank?: number | null;
  spellings?: SeedSpelling[];
  readings?: SeedReading[];
  senses?: SeedSense[];
  reading_restrictions?: SeedReadingRestriction[];
};

export function seedEntry(opts: SeedEntryOptions, db: Database = sqlite): void {
  const ts = '2024-01-01T00:00:00.000Z';
  db.prepare(
    `INSERT INTO dictionary_entry (id, is_common, priority_rank, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`
  ).run(opts.id, opts.is_common ?? 1, opts.priority_rank ?? null, ts, ts);

  for (const spelling of opts.spellings ?? []) {
    db.prepare(
      `INSERT INTO entry_spelling (entry_id, text, is_primary, priority_rank)
         VALUES (?, ?, ?, ?)`
    ).run(opts.id, spelling.text, spelling.is_primary ?? 0, spelling.priority_rank ?? null);
  }

  for (const reading of opts.readings ?? []) {
    db.prepare(
      `INSERT INTO entry_reading (entry_id, text, is_primary, no_kanji, romaji)
         VALUES (?, ?, ?, ?, ?)`
    ).run(
      opts.id,
      reading.text,
      reading.is_primary ?? 0,
      reading.no_kanji ?? 0,
      reading.romaji ?? null
    );
  }

  for (const sense of opts.senses ?? []) {
    db.prepare(
      `INSERT INTO entry_sense (
           entry_id, sense_index, glosses_json, parts_of_speech_json,
           misc_tags_json, field_tags_json, dialect_tags_json, info_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
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
    db.prepare(
      `INSERT INTO entry_reading_spelling (entry_id, reading_text, spelling_text)
         VALUES (?, ?, ?)`
    ).run(opts.id, restriction.reading_text, restriction.spelling_text);
  }
}
