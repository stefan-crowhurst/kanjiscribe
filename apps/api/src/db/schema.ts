import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const dictionaryEntry = sqliteTable('dictionary_entry', {
  id: integer('id').primaryKey(),
  isCommon: integer('is_common', { mode: 'boolean' }).notNull(),
  priorityRank: integer('priority_rank'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const entrySpelling = sqliteTable(
  'entry_spelling',
  {
    entryId: integer('entry_id').notNull(),
    text: text('text').notNull(),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull(),
    priorityRank: integer('priority_rank')
  },
  (table) => [primaryKey({ columns: [table.entryId, table.text] }), uniqueIndex('idx_entry_spelling_text').on(table.text)]
);

export const entryReading = sqliteTable(
  'entry_reading',
  {
    entryId: integer('entry_id').notNull(),
    text: text('text').notNull(),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull(),
    noKanji: integer('no_kanji', { mode: 'boolean' }).notNull()
  },
  (table) => [primaryKey({ columns: [table.entryId, table.text] }), uniqueIndex('idx_entry_reading_text').on(table.text)]
);

export const entryReadingSpelling = sqliteTable(
  'entry_reading_spelling',
  {
    entryId: integer('entry_id').notNull(),
    readingText: text('reading_text').notNull(),
    spellingText: text('spelling_text').notNull()
  },
  (table) => [primaryKey({ columns: [table.entryId, table.readingText, table.spellingText] })]
);

export const entrySense = sqliteTable(
  'entry_sense',
  {
    entryId: integer('entry_id').notNull(),
    senseIndex: integer('sense_index').notNull(),
    glossesJson: text('glosses_json').notNull(),
    partsOfSpeechJson: text('parts_of_speech_json').notNull(),
    miscTagsJson: text('misc_tags_json').notNull(),
    fieldTagsJson: text('field_tags_json').notNull(),
    dialectTagsJson: text('dialect_tags_json').notNull(),
    infoJson: text('info_json').notNull()
  },
  (table) => [primaryKey({ columns: [table.entryId, table.senseIndex] })]
);

export const kanji = sqliteTable('kanji', {
  literal: text('literal').primaryKey(),
  meaningsJson: text('meanings_json').notNull(),
  onyomiJson: text('onyomi_json').notNull(),
  kunyomiJson: text('kunyomi_json').notNull(),
  strokeCount: integer('stroke_count').notNull(),
  grade: integer('grade'),
  jlptLevel: integer('jlpt_level'),
  frequencyRank: integer('frequency_rank')
});

export const kanjiStrokeAsset = sqliteTable('kanji_stroke_asset', {
  kanjiLiteral: text('kanji_literal').primaryKey(),
  assetPath: text('asset_path').notNull(),
  sourceVersion: text('source_version').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const studyItem = sqliteTable(
  'study_item',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    surfaceForm: text('surface_form').notNull(),
    selectedReading: text('selected_reading').notNull(),
    dictionaryEntryId: integer('dictionary_entry_id').notNull(),
    sourceType: text('source_type').notNull(),
    sourceRef: text('source_ref'),
    createdAt: text('created_at').notNull(),
    archivedAt: text('archived_at')
  },
  (table) => [uniqueIndex('idx_study_item_unique').on(table.surfaceForm, table.selectedReading, table.dictionaryEntryId)]
);

export const studyItemKanji = sqliteTable(
  'study_item_kanji',
  {
    studyItemId: integer('study_item_id').notNull(),
    position: integer('position').notNull(),
    kanjiLiteral: text('kanji_literal').notNull()
  },
  (table) => [primaryKey({ columns: [table.studyItemId, table.position] })]
);

export const dailyAssignment = sqliteTable('daily_assignment', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studyItemId: integer('study_item_id').notNull(),
  assignedForDate: text('assigned_for_date').notNull(),
  status: text('status').notNull(),
  origin: text('origin').notNull(),
  timeSpentMs: integer('time_spent_ms'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at')
});

export const studySession = sqliteTable('study_session', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  startedAt: text('started_at').notNull(),
  endedAt: text('ended_at'),
  mode: text('mode').notNull(),
  deviceType: text('device_type')
});

export const studyEvent = sqliteTable('study_event', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  studyItemId: integer('study_item_id').notNull(),
  dailyAssignmentId: integer('daily_assignment_id'),
  studySessionId: integer('study_session_id'),
  eventType: text('event_type').notNull(),
  occurredAt: text('occurred_at').notNull(),
  durationMs: integer('duration_ms'),
  metadataJson: text('metadata_json')
});

export const importerRun = sqliteTable('importer_run', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  dataset: text('dataset').notNull(),
  sourceVersion: text('source_version'),
  sourceFile: text('source_file').notNull(),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  recordsProcessed: integer('records_processed'),
  recordsFailed: integer('records_failed'),
  status: text('status').notNull(),
  errorMessage: text('error_message')
});

export const appConfig = sqliteTable('app_config', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull()
});
