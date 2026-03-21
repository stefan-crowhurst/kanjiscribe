BEGIN;

CREATE TABLE IF NOT EXISTS dictionary_entry (
  id INTEGER PRIMARY KEY,
  is_common INTEGER NOT NULL,
  priority_rank INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entry_spelling (
  entry_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  is_primary INTEGER NOT NULL,
  priority_rank INTEGER,
  PRIMARY KEY (entry_id, text),
  FOREIGN KEY (entry_id) REFERENCES dictionary_entry(id)
);

CREATE TABLE IF NOT EXISTS entry_reading (
  entry_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  is_primary INTEGER NOT NULL,
  no_kanji INTEGER NOT NULL,
  PRIMARY KEY (entry_id, text),
  FOREIGN KEY (entry_id) REFERENCES dictionary_entry(id)
);

CREATE TABLE IF NOT EXISTS entry_reading_spelling (
  entry_id INTEGER NOT NULL,
  reading_text TEXT NOT NULL,
  spelling_text TEXT NOT NULL,
  PRIMARY KEY (entry_id, reading_text, spelling_text),
  FOREIGN KEY (entry_id, reading_text) REFERENCES entry_reading(entry_id, text),
  FOREIGN KEY (entry_id, spelling_text) REFERENCES entry_spelling(entry_id, text)
);

CREATE TABLE IF NOT EXISTS entry_sense (
  entry_id INTEGER NOT NULL,
  sense_index INTEGER NOT NULL,
  glosses_json TEXT NOT NULL,
  parts_of_speech_json TEXT NOT NULL,
  misc_tags_json TEXT NOT NULL,
  field_tags_json TEXT NOT NULL,
  dialect_tags_json TEXT NOT NULL,
  info_json TEXT NOT NULL,
  PRIMARY KEY (entry_id, sense_index),
  FOREIGN KEY (entry_id) REFERENCES dictionary_entry(id)
);

CREATE TABLE IF NOT EXISTS kanji (
  literal TEXT PRIMARY KEY,
  meanings_json TEXT NOT NULL,
  onyomi_json TEXT NOT NULL,
  kunyomi_json TEXT NOT NULL,
  stroke_count INTEGER NOT NULL,
  grade INTEGER,
  jlpt_level INTEGER,
  frequency_rank INTEGER
);

CREATE TABLE IF NOT EXISTS kanji_stroke_asset (
  kanji_literal TEXT PRIMARY KEY,
  asset_path TEXT NOT NULL,
  source_version TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (kanji_literal) REFERENCES kanji(literal)
);

CREATE TABLE IF NOT EXISTS study_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surface_form TEXT NOT NULL,
  selected_reading TEXT NOT NULL,
  dictionary_entry_id INTEGER NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('manual', 'anki')),
  source_ref TEXT,
  created_at TEXT NOT NULL,
  archived_at TEXT,
  UNIQUE (surface_form, selected_reading, dictionary_entry_id),
  FOREIGN KEY (dictionary_entry_id) REFERENCES dictionary_entry(id)
);

CREATE TABLE IF NOT EXISTS study_item_kanji (
  study_item_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  kanji_literal TEXT NOT NULL,
  PRIMARY KEY (study_item_id, position),
  FOREIGN KEY (study_item_id) REFERENCES study_item(id),
  FOREIGN KEY (kanji_literal) REFERENCES kanji(literal)
);

CREATE TABLE IF NOT EXISTS daily_assignment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_item_id INTEGER NOT NULL,
  assigned_for_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'skipped', 'archived')),
  origin TEXT NOT NULL CHECK (origin IN ('manual', 'anki_rule', 'carryover', 'requeue')),
  time_spent_ms INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (study_item_id) REFERENCES study_item(id)
);

CREATE TABLE IF NOT EXISTS study_session (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  mode TEXT NOT NULL CHECK (mode IN ('today', 'backlog', 'item_detail')),
  device_type TEXT
);

CREATE TABLE IF NOT EXISTS study_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  study_item_id INTEGER NOT NULL,
  daily_assignment_id INTEGER,
  study_session_id INTEGER,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'added_manual',
    'added_anki',
    'reading_selected',
    'assignment_created',
    'shown',
    'completed',
    'skipped',
    'reopened'
  )),
  occurred_at TEXT NOT NULL,
  duration_ms INTEGER,
  metadata_json TEXT,
  FOREIGN KEY (study_item_id) REFERENCES study_item(id),
  FOREIGN KEY (daily_assignment_id) REFERENCES daily_assignment(id),
  FOREIGN KEY (study_session_id) REFERENCES study_session(id)
);

CREATE TABLE IF NOT EXISTS importer_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dataset TEXT NOT NULL CHECK (dataset IN ('jmdict', 'kanjidic2', 'kanjivg')),
  source_version TEXT,
  source_file TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  records_processed INTEGER,
  records_failed INTEGER,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entry_spelling_text ON entry_spelling(text);
CREATE INDEX IF NOT EXISTS idx_entry_reading_text ON entry_reading(text);
CREATE INDEX IF NOT EXISTS idx_daily_assignment_date_status ON daily_assignment(assigned_for_date, status);
CREATE INDEX IF NOT EXISTS idx_daily_assignment_study_item ON daily_assignment(study_item_id);

CREATE VIEW IF NOT EXISTS v_day_summary AS
SELECT
  assigned_for_date,
  COUNT(*) AS total_assignments,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
  SUM(COALESCE(time_spent_ms, 0)) AS total_time_ms,
  SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_count,
  CASE WHEN SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) = 0
       THEN 1 ELSE 0 END AS is_fully_completed
FROM daily_assignment
GROUP BY assigned_for_date;

CREATE VIEW IF NOT EXISTS v_study_item_stats AS
SELECT
  si.id AS study_item_id,
  si.surface_form,
  si.selected_reading,
  COUNT(da.id) AS total_assignments,
  SUM(CASE WHEN da.status = 'completed' THEN 1 ELSE 0 END) AS times_completed,
  SUM(COALESCE(da.time_spent_ms, 0)) AS total_time_ms,
  AVG(CASE WHEN da.status = 'completed' THEN da.time_spent_ms END) AS avg_completion_time_ms,
  MIN(da.assigned_for_date) AS first_assigned,
  MAX(da.assigned_for_date) AS last_assigned
FROM study_item si
LEFT JOIN daily_assignment da ON da.study_item_id = si.id
GROUP BY si.id;

CREATE VIEW IF NOT EXISTS v_kanji_stats AS
SELECT
  sik.kanji_literal,
  COUNT(DISTINCT sik.study_item_id) AS word_count,
  COUNT(da.id) AS total_assignments,
  SUM(CASE WHEN da.status = 'completed' THEN 1 ELSE 0 END) AS times_drilled
FROM study_item_kanji sik
JOIN daily_assignment da ON da.study_item_id = sik.study_item_id
GROUP BY sik.kanji_literal;

CREATE VIEW IF NOT EXISTS v_backlog_summary AS
SELECT
  da.id AS assignment_id,
  da.study_item_id,
  si.surface_form,
  si.selected_reading,
  da.assigned_for_date,
  da.status,
  da.origin,
  julianday('now') - julianday(da.assigned_for_date) AS days_overdue
FROM daily_assignment da
JOIN study_item si ON si.id = da.study_item_id
WHERE da.status IN ('pending', 'skipped')
ORDER BY da.assigned_for_date ASC;

COMMIT;
