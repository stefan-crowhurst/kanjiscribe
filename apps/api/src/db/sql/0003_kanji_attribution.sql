BEGIN;

CREATE TABLE IF NOT EXISTS kanji_attribution (
  assignment_id INTEGER NOT NULL,
  kanji_literal TEXT NOT NULL,
  stroke_count INTEGER NOT NULL,
  writes_count INTEGER NOT NULL,
  attributed_time_ms REAL NOT NULL,
  PRIMARY KEY (assignment_id, kanji_literal),
  FOREIGN KEY (assignment_id) REFERENCES daily_assignment(id) ON DELETE CASCADE,
  FOREIGN KEY (kanji_literal) REFERENCES kanji(literal)
);

CREATE INDEX IF NOT EXISTS idx_kanji_attribution_literal ON kanji_attribution(kanji_literal);
CREATE INDEX IF NOT EXISTS idx_kanji_attribution_stroke_count ON kanji_attribution(stroke_count);

CREATE VIEW IF NOT EXISTS v_kanji_timing AS
SELECT
  kanji_literal,
  AVG(attributed_time_ms / writes_count) AS mean_per_write_time_ms
FROM kanji_attribution
GROUP BY kanji_literal;

CREATE VIEW IF NOT EXISTS v_stroke_count_bucket AS
SELECT
  stroke_count,
  AVG(attributed_time_ms / writes_count) AS mean_per_write_time_ms
FROM kanji_attribution
GROUP BY stroke_count;

CREATE VIEW IF NOT EXISTS v_kanji_global_slope AS
SELECT
  SUM(attributed_time_ms) / SUM(writes_count * stroke_count) AS ms_per_stroke
FROM kanji_attribution;

COMMIT;
