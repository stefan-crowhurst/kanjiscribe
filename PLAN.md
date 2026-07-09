# Kanjiscribe Implementation Plan

## Product Summary

`kanjiscribe` is a private companion app for Anki, not a replacement for it.

Its job is to help drill words that have proven difficult, with a single screen that shows:

- the target word with furigana
- the chosen reading for that word
- a short English gloss
- per-kanji meanings and common readings
- stroke-order visuals for each kanji
- timing and completion tracking for each drill

Anki remains the source of truth for scheduling and the broader learning workflow.

## Confirmed Product Decisions

- Companion app only; no independent SRS scheduling.
- SQLite is the correct database choice for the Pi-hosted single-user setup.
- Use TypeScript across the stack.
- Use `zod` for request/response and importer validation.
- Use a monorepo with shared types/schemas.
- Do not iframe Jisho. Build a local UI from open datasets.
- Do not include Tatoeba/example sentence ingestion in MVP.
- Ambiguous word matches are resolved at intake time.
- The same tracked word can be assigned many times across many days.
- Missed days matter: incomplete assignments must remain visible and drillable.
- Each assignment must preserve both:
  - `assigned_for_date`
  - actual completion timestamp
- Future Anki integration should support configurable intake triggers such as `Again` and `Hard`.

## Non-Goals For MVP

- Replacing Anki review scheduling
- Example sentence corpus ingestion
- Mobile Anki plugin support
- Fully automatic handling of all inflected forms
- Advanced stroke animation polish
- Multi-user auth/permissions

## Recommended Architecture

## Monorepo Layout

```text
apps/
  api/
  web/
packages/
  shared/
  importer/
```

### `apps/api`

- TypeScript API server
- Prefer Fastify for typed schemas and lightweight structure
- Serves JSON endpoints and the built frontend assets
- Talks directly to SQLite through a typed DB layer

### `apps/web`

- React + Vite frontend
- Mobile-first responsive UI
- Can later be wrapped as a light PWA for better mobile usage

### `packages/shared`

- `zod` schemas
- shared DTOs
- shared domain types
- shared constants and enums

### `packages/importer`

- CLI or script entry points for importing/updating source datasets
- transforms raw dataset files into normalized SQLite records
- stores static KanjiVG assets locally for frontend rendering

## Deployment

- Run the app on the Raspberry Pi
- Expose it only on the Tailscale network
- Keep runtime simple:
  - one API process (Fastify)
  - one SQLite database file
  - one local directory for imported assets (`data/kanji-svg/`)
  - Fastify serves the built frontend assets and the SVG directory as a static file route (e.g. `/static/kanji-svg/`)
- Avoid splitting frontend/backend deployments unless clearly necessary later

## Technical Stack

- Frontend: React, Vite, TypeScript
- Backend: Fastify, TypeScript
- Database: SQLite
- DB layer: Drizzle ORM (schema-first, declarative migrations) with `better-sqlite3` driver
- Validation: `zod`
- Styling: plain CSS or CSS modules
- Charts/heatmap: lightweight library or custom SVG/CSS where simple
- Monorepo tooling: pnpm workspaces

## Data Sources

Use the original open datasets directly instead of relying on Jisho pages.

- `JMdict`: word spellings, readings, senses, tags
  - Download: http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz (English-only, gzipped XML)
  - License: Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)
- `KANJIDIC2`: kanji meanings, readings, grade/frequency metadata
  - Download: http://www.edrdg.org/kanjidic/kanjidic2.xml.gz (gzipped XML)
  - License: Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0)
- `KanjiVG`: stroke-order SVG/path data
  - Download: https://github.com/KanjiVG/kanjivg/releases (release archive containing SVG files)
  - License: Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0)

## Importer Responsibilities

- download or read source dataset files from a configured local directory
- normalize source records into SQLite tables
- build search-friendly indexes
- extract/store KanjiVG SVG files to a local directory on disk
- record importer version/source timestamps for future refreshes
- surface import errors clearly instead of silently skipping malformed records

### Dataset Details And Import Guidance

#### JMdict

- Source format: XML (~180MB uncompressed, gzipped download)
- Contains ~200,000 entries with nested kanji elements, reading elements, and sense groups
- Critical: bulk inserts must be wrapped in SQLite transactions (batch 1000-5000 entries per transaction) or import will be extremely slow
- Must correctly handle `re_restr` elements (reading restrictions) by populating `entry_reading_spelling`
- Use a streaming XML parser (e.g. `sax` or `fast-xml-parser` in streaming mode) rather than loading the entire DOM into memory
- The `ent_seq` integer is the stable identifier used as `dictionary_entry.id`
- Use the `JMdict_e` (English-only) variant, not the full multilingual `JMdict` — it is significantly smaller and this app only needs English glosses
- Priority tags (`ke_pri` / `re_pri`) are on individual kanji/reading elements, not on the entry itself. The importer must aggregate them up to the entry level to derive `is_common` and `priority_rank`
- Key XML element mapping within each `<entry>`:
  - `ent_seq` → `dictionary_entry.id`
  - `k_ele/keb` → spelling text → `entry_spelling.text`
  - `k_ele/ke_pri` → spelling priority tags (for `is_common` / `priority_rank`)
  - `r_ele/reb` → reading text → `entry_reading.text`
  - `r_ele/re_nokanji` → if present, `entry_reading.no_kanji = true`
  - `r_ele/re_restr` → reading restriction — value is a spelling text. Create one `entry_reading_spelling` row per `re_restr` element.
  - `r_ele/re_pri` → reading priority tags
  - `sense` → one per sense group (0-indexed by order of appearance → `entry_sense.sense_index`)
  - `sense/gloss` → collect into `glosses_json` array
  - `sense/pos` → collect into `parts_of_speech_json` array
  - `sense/misc` → collect into `misc_tags_json` array
  - `sense/field` → collect into `field_tags_json` array
  - `sense/dial` → collect into `dialect_tags_json` array
  - `sense/s_inf` → collect into `info_json` array
- An entry may have zero `k_ele` elements (kana-only words). These entries still get an `entry_reading` but no `entry_spelling` rows. The search logic must handle this — kana-only entries are matched via `entry_reading.text` only.

#### KANJIDIC2

- Source format: XML (~13,000 kanji entries, much smaller than JMdict)
- Each entry has the kanji literal as its natural key (`kanji.literal` PK)
- Simpler structure; can use a DOM parser if convenient since the file is small (~12MB uncompressed)
- Key XML paths within each `<character>` element:
  - `literal` → the kanji character (PK)
  - `misc/grade` → school grade level
  - `misc/stroke_count` → stroke count (take the first if multiple)
  - `misc/jlpt` → JLPT level
  - `misc/freq` → newspaper frequency rank
  - `reading_meaning/rmgroup/reading[@r_type='ja_on']` → on'yomi readings (collect into `onyomi_json` array)
  - `reading_meaning/rmgroup/reading[@r_type='ja_kun']` → kun'yomi readings (collect into `kunyomi_json` array)
  - `reading_meaning/rmgroup/meaning` (no `m_lang` attribute, or `m_lang='en'`) → English meanings (collect into `meanings_json` array)
- Filter out non-English meanings (those with `m_lang` set to something other than `en`)

#### KanjiVG

- The GitHub release archive contains a `kanji/` directory with individual SVG files already named by Unicode codepoint (e.g. `098df.svg`). Use these directly — copy them to the target `data/kanji-svg/` directory rather than parsing the bundled XML.
- Total: ~11,000 individual SVG files
- Recommended layout: `data/kanji-svg/{unicode_codepoint}.svg` (e.g. `data/kanji-svg/098df.svg` for 食 U+98DF)
- The `kanji_stroke_asset` table stores only the relative path; the API serves the directory statically
- Use the 5-digit zero-padded hex Unicode codepoint as the filename for predictable URL construction

## Licensing / Attribution

- Ship an `About` or `Data Sources` page in the app
- Include the required attribution text for imported datasets
- Keep source URLs and license notes in the repo and app UI

## Domain Model

Split the schema into two groups:

- reference data
- user study data

This is the most important schema choice in the project.

### Foreign Key and Deletion Policy

No rows should ever be hard-deleted in user study tables. Archival is handled via status fields (`daily_assignment.status = 'archived'`, `study_item.archived_at`). All foreign keys should use the default `RESTRICT` behaviour — if something tries to delete a referenced row, the database should reject it. This is a safety net; the application should never attempt hard deletes on these tables.

For reference data tables (dictionary, kanji), re-imports should use `INSERT OR REPLACE` / upsert semantics rather than delete-then-insert, to avoid breaking FKs from `study_item.dictionary_entry_id`.

SQLite does not enforce foreign keys by default. The API must enable them at connection time with `PRAGMA foreign_keys = ON`.

### Date and Timestamp Convention

SQLite has no native date/timestamp types. All date/time values are stored as text:

- **Date-only fields** (e.g. `assigned_for_date`): use `YYYY-MM-DD` format (e.g. `2025-03-18`)
- **Timestamp fields** (e.g. `created_at`, `completed_at`): use ISO-8601 format with UTC timezone (e.g. `2025-03-18T14:30:00.000Z`)

Drizzle schema should use `text` mode for these columns. The `zod` schemas in `packages/shared` should validate the format.

## Reference Data Tables

### `dictionary_entry`

Canonical word entry imported from `JMdict`.

Use the stable JMdict `ent_seq` integer as the primary key directly. There is no need for a local UUID since this is a single-user local database and the source IDs are already unique and stable.

Fields:

- `id` integer PK — the JMdict `ent_seq` value
- `is_common` boolean — derived during import: `true` if any spelling or reading element carries a priority tag from the set `{news1, ichi1, spec1, spec2, gai1}`. This matches Jisho's "common word" indicator.
- `priority_rank` integer nullable — the lowest `nfXX` frequency rank found across all spelling/reading priority tags for this entry (e.g. `nf01` = 1, `nf48` = 48). Null if no `nf` tags exist.
- `created_at` text — ISO-8601 UTC timestamp
- `updated_at` text — ISO-8601 UTC timestamp

Note: JMdict does not contain JLPT level data for words (it was removed from the dataset). JLPT levels exist only for kanji in KANJIDIC2. Do not add a `jlpt_level` column here.

### `entry_spelling`

Written forms for an entry. Uses a composite key of `(entry_id, text)` since a given entry cannot have duplicate spellings.

Fields:

- `entry_id` integer FK → `dictionary_entry.id` (PK part 1)
- `text` text (PK part 2)
- `is_primary` boolean — `true` for the first-listed kanji element in the JMdict entry
- `priority_rank` integer nullable — lowest `nfXX` rank from this spelling's priority tags, null if none

### `entry_reading`

Kana readings for an entry. Uses a composite key of `(entry_id, text)` since a given entry cannot have duplicate readings.

Fields:

- `entry_id` integer FK → `dictionary_entry.id` (PK part 1)
- `text` text (PK part 2)
- `is_primary` boolean — `true` for the first-listed reading element in the JMdict entry
- `no_kanji` boolean — `true` if the reading has a `re_nokanji` element, meaning it is not a reading of any kanji spelling

### `entry_reading_spelling`

Mapping table for reading restrictions when a reading only applies to some spellings. Uses the natural composite key from both parent tables.

**Important convention**: rows are only inserted when a reading has `re_restr` elements in JMdict. If a reading has no restrictions, it applies to all spellings for that entry and no rows should be created. The application should interpret "no rows for this reading" as "applies to all spellings."

Fields:

- `entry_id` integer (PK part 1)
- `reading_text` text (PK part 2) — with `(entry_id, reading_text)` FK → `entry_reading`
- `spelling_text` text (PK part 3) — with `(entry_id, spelling_text)` FK → `entry_spelling`

Note: Drizzle's SQLite schema DSL may not support multi-column foreign keys declaratively. If so, define the composite FK constraints via raw SQL in a custom migration file. The data integrity matters more than the ORM expressing it — the importer controls all writes to this table anyway, so application-level validation is an acceptable fallback.

### `entry_sense`

Sense-level data from `JMdict`. Uses a composite key of `(entry_id, sense_index)` since sense ordering is inherent to the source data.

Fields:

- `entry_id` integer FK → `dictionary_entry.id` (PK part 1)
- `sense_index` integer (PK part 2)
- `glosses_json` text
- `parts_of_speech_json` text
- `misc_tags_json` text
- `field_tags_json` text
- `dialect_tags_json` text
- `info_json` text

SQLite JSON text is acceptable here because these fields are read and displayed, not queried. English full-text search on glosses is not needed since this is a companion tool for words the user has already encountered.

### `kanji`

Kanji metadata imported from `KANJIDIC2`. Uses the kanji literal character as the natural primary key.

Fields:

- `literal` text PK — the kanji character itself (e.g. `食`)
- `meanings_json` text — JSON array of English meanings
- `onyomi_json` text — JSON array of on'yomi readings in katakana
- `kunyomi_json` text — JSON array of kun'yomi readings in hiragana
- `stroke_count` integer
- `grade` integer nullable — school grade level (1-10, where 8-10 are secondary school)
- `jlpt_level` integer nullable
- `frequency_rank` integer nullable — newspaper frequency ranking

### `kanji_stroke_asset`

Stroke-order display data from `KanjiVG`. SVG files are stored on disk rather than in the database, keeping the DB lean and making the files easy to serve statically.

Fields:

- `kanji_literal` text PK FK → `kanji.literal`
- `asset_path` text — relative path within the static assets directory (e.g. `kanji-svg/098df.svg` for 食)
- `source_version` text
- `updated_at` text — ISO-8601 UTC timestamp

The API serves the SVG directory as a static file route (e.g. `/static/kanji-svg/`). The frontend constructs the URL from the `asset_path` field. This avoids reading SVG content from the DB on every drill screen render.

## User Study Tables

### `study_item`

Persistent tracked word/reading pair for the companion app.

This is the reusable pool of words you care about. Uses auto-increment integer PK since these are user-generated records with no external stable identifier.

Fields:

- `id` integer PK autoincrement
- `surface_form` text
- `selected_reading` text
- `dictionary_entry_id` integer FK → `dictionary_entry.id`
- `source_type` text — `manual` or `anki`
- `source_ref` text nullable
- `created_at` text — ISO-8601 UTC timestamp
- `archived_at` text nullable — ISO-8601 UTC timestamp

Uniqueness constraint:

- unique on `(surface_form, selected_reading, dictionary_entry_id)`

This prevents accidental duplicate tracked words while still allowing the same dictionary entry to exist under different chosen forms/readings if ever needed.

### `study_item_kanji`

Ordered kanji decomposition for a tracked word.

Fields:

- `study_item_id` integer FK → `study_item.id` (PK part 1)
- `position` integer (PK part 2)
- `kanji_literal` text FK → `kanji.literal`

PK is `(study_item_id, position)` rather than `(study_item_id, kanji_literal)` because the same kanji can appear more than once in a word (e.g. 人々, 時々). Position preserves the original character order for rendering.

Note: kana-only words (e.g. すごい) will have zero rows in this table. The drill screen should handle this gracefully by showing only the word/reading/gloss section without kanji panels.

### `daily_assignment`

One dated piece of work for a `study_item`.

This is the core table for backlog and day-based reporting. Uses auto-increment integer PK.

Fields:

- `id` integer PK autoincrement
- `study_item_id` integer FK → `study_item.id`
- `assigned_for_date` text (ISO date string, e.g. `2025-03-18`)
- `status` text — `pending`, `completed`, `skipped`, `archived`
- `origin` text — `manual`, `anki_rule`, `carryover`, `requeue`
- `time_spent_ms` integer nullable — total drilling time for this assignment
- `created_at` text — ISO-8601 UTC timestamp
- `completed_at` text nullable — ISO-8601 UTC timestamp

Important rule:

- a missed assignment is not deleted or auto-rewritten
- it remains incomplete until explicitly resolved

### `study_session`

Represents an actual drilling session. Uses auto-increment integer PK.

Fields:

- `id` integer PK autoincrement
- `started_at` text — ISO-8601 UTC timestamp
- `ended_at` text nullable — ISO-8601 UTC timestamp
- `mode` text — `today`, `backlog`, `item_detail`
- `device_type` text nullable

### `study_event`

Append-only event log of what actually happened. Deferred to a later phase (after Phase 4) to keep the initial drill experience implementation simpler. The schema should still be created in Phase 1 migrations so it is ready when needed.

In Phase 4, the drill screen writes directly to `daily_assignment` (updating `status`, `completed_at`, `time_spent_ms`). Event logging is layered on afterward.

Fields:

- `id` integer PK autoincrement
- `study_item_id` integer FK → `study_item.id`
- `daily_assignment_id` integer nullable FK → `daily_assignment.id`
- `study_session_id` integer nullable FK → `study_session.id`
- `event_type` text
- `occurred_at` text — ISO-8601 UTC timestamp
- `duration_ms` integer nullable
- `metadata_json` text nullable

`event_type` values:

- `added_manual`
- `added_anki`
- `reading_selected`
- `assignment_created`
- `shown`
- `completed`
- `skipped`
- `reopened`

## Importer Metadata Table

### `importer_run`

Tracks each import execution for auditability and to support re-import decisions.

Fields:

- `id` integer PK autoincrement
- `dataset` text — `jmdict`, `kanjidic2`, `kanjivg`
- `source_version` text nullable — version string or date from the dataset
- `source_file` text — path to the source file used
- `started_at` text — ISO-8601 UTC timestamp
- `completed_at` text nullable — ISO-8601 UTC timestamp
- `records_processed` integer nullable
- `records_failed` integer nullable
- `status` text — `running`, `completed`, `failed`
- `error_message` text nullable

This allows the importer to check whether a dataset has already been imported at a given version and skip unnecessary work, and surfaces any past failures.

## Optional Config Table

### `app_config`

Use a small config table or typed config file for behavior that should be adjustable later.

Suggested settings:

- anki intake trigger list
- default dashboard range
- backlog sorting preference
- importer source paths/versions if needed

## Derived Views

Do not store dashboard aggregates as the primary truth.

Given the low data volumes of a single-user app, use live SQLite VIEWs derived from `daily_assignment` and `study_item`. These will remain performant for years of usage. Only introduce materialized summary tables if query latency becomes noticeable.

### `v_day_summary`

One row per date that has at least one assignment.

```sql
CREATE VIEW v_day_summary AS
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
```

Notes:
- `is_fully_completed` = 1 means the day has at least one `completed` assignment **and** no `pending` or `skipped` assignments. (Migration `0002` tightened this from the legacy rule, which only checked for zero `pending` and let a no-study all-archived day read as "fully completed".)
- Rows with `status = 'archived'` are excluded from `v_day_summary` entirely; a day reduced to only archived assignments drops out of the view (an "empty day"), so the heatmap renders it as no-activity rather than as a green "done" day.
- Therefore the frontend no longer needs the `completed_count > 0 AND is_fully_completed = 1` rider; `is_fully_completed` alone is sufficient.

Used by: dashboard heatmap, calendar hover details, completion stats.

### `v_study_item_stats`

Aggregated stats per tracked word.

```sql
CREATE VIEW v_study_item_stats AS
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
```

Used by: most-drilled words, words with longest average time, repeat count, interval stats.

### `v_kanji_stats`

Aggregated stats per kanji character.

```sql
CREATE VIEW v_kanji_stats AS
SELECT
  sik.kanji_literal,
  COUNT(DISTINCT sik.study_item_id) AS word_count,
  COUNT(da.id) AS total_assignments,
  SUM(CASE WHEN da.status = 'completed' THEN 1 ELSE 0 END) AS times_drilled
FROM study_item_kanji sik
JOIN daily_assignment da ON da.study_item_id = sik.study_item_id
GROUP BY sik.kanji_literal;
```

Used by: most-seen kanji, kanji detail stats.

### `v_backlog_summary`

All incomplete assignments with overdue context.

```sql
CREATE VIEW v_backlog_summary AS
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
```

Used by: backlog view, overdue counts, oldest overdue date on dashboard.

## Search Strategy

Search quality matters because intake-time ambiguity resolution is central to the product.

### MVP Search Behavior

The search query `q` is a single text string. The search endpoint should try the following in order and merge results:

1. Exact match on `entry_spelling.text` — returns entries where a spelling matches exactly
2. Exact match on `entry_reading.text` — returns entries where a reading matches exactly (catches kana-only words with no spellings)
3. Prefix match on `entry_spelling.text` (using `LIKE 'query%'`) — for manual lookup convenience
4. Prefix match on `entry_reading.text` (using `LIKE 'query%'`)

Results should be deduplicated by `dictionary_entry.id` and ordered by: exact matches before prefix matches, common words (`is_common = true`) before uncommon, lower `priority_rank` before higher.

### Good MVP UX

When multiple entries match, show a candidate list with:

- spelling
- kana reading
- short gloss
- common/commonness indicator if available

The user first selects the correct dictionary entry, then selects the specific reading for that entry. If the entry has only one applicable reading (or one reading that applies to the selected spelling), it should be preselected. If multiple readings exist, show them all and require the user to choose. The selected reading becomes `study_item.selected_reading`.

### Suggested Technical Support

- add indexes on `entry_spelling.text` and `entry_reading.text`
- consider SQLite FTS only if basic indexed search feels too limited
- defer heavy deinflection logic until there is real evidence it is needed

## Core Behavioral Rules

### Intake

- Manual intake searches the local dictionary.
- If one strong match exists, preselect it.
- If several plausible matches exist, require explicit user confirmation.
- Creating a tracked word should:
  - create or reuse a `study_item`
  - populate `study_item_kanji` by extracting kanji from the `surface_form`: iterate each character, check if its Unicode codepoint falls in the CJK Unified Ideographs range (U+4E00–U+9FFF) or CJK Extension A (U+3400–U+4DBF), and if so look it up in the `kanji` table. Create a row for each match with its position (0-indexed). Characters not found in the `kanji` table (rare/uncommon kanji not in KANJIDIC2) should be skipped with a warning logged.
  - create a new `daily_assignment`
  - (after Phase 4b) append appropriate `study_event` records

### Repeated Words

- If the same word appears again later, reuse the existing `study_item`.
- Create a new `daily_assignment` for the new date/intake event.
- This preserves a clean history of repeated practice without duplicating the tracked word itself.

### Missed Days / Backlog

- Incomplete assignments remain visible across days.
- The app must support viewing all incomplete assignments, not just today.
- Completing an overdue assignment must preserve:
  - the original `assigned_for_date`
  - the actual `completed_at` timestamp

### Carryover

- Do not automatically reassign missed work to a new date by default.
- If carryover/requeue is added later, it should create a new assignment while preserving the original missed one.

## API Outline

All endpoints return JSON. Error responses use a consistent shape: `{ "error": "message" }` with an appropriate HTTP status code (400 for validation, 404 for not found, 500 for server errors).

All request/response shapes should have corresponding `zod` schemas in `packages/shared` so they can be validated on both sides.

### Dictionary / Intake

#### `GET /dictionary/search?q=<query>`

Search the local dictionary. Returns a list of candidate entries.

Response:

```json
{
  "results": [
    {
      "entry_id": 1358280,
      "primary_spelling": "食べる",
      "primary_reading": "たべる",
      "glosses": ["to eat"],
      "is_common": true,
      "readings": [
        { "text": "たべる", "no_kanji": false }
      ],
      "spellings": [
        { "text": "食べる", "is_primary": true }
      ],
      "match_type": "exact_spelling"
    }
  ]
}
```

- `match_type` is one of: `exact_spelling`, `exact_reading`, `prefix_spelling`, `prefix_reading`
- `glosses` contains only the first sense's gloss array (for display in the candidate list)
- `readings` and `spellings` are the full lists so the intake UI can offer reading selection

#### `GET /dictionary/entries/:id`

Full detail for a single dictionary entry.

Response:

```json
{
  "entry": {
    "id": 1358280,
    "is_common": true,
    "priority_rank": 2,
    "spellings": [
      { "text": "食べる", "is_primary": true, "priority_rank": 2 }
    ],
    "readings": [
      { "text": "たべる", "is_primary": true, "no_kanji": false }
    ],
    "senses": [
      {
        "sense_index": 0,
        "glosses": ["to eat"],
        "parts_of_speech": ["Ichidan verb", "Transitive verb"],
        "misc_tags": [],
        "field_tags": [],
        "dialect_tags": [],
        "info": []
      }
    ],
    "reading_restrictions": [
      { "reading_text": "たべる", "spelling_text": "食べる" }
    ]
  }
}
```

- `reading_restrictions` is an empty array if no restrictions exist (meaning all readings apply to all spellings)
- `senses` is the full list (all senses, not just the first)

#### `POST /study-items/intake`

Request body:

```json
{
  "surface_form": "食べる",
  "selected_reading": "たべる",
  "dictionary_entry_id": 1358280,
  "source_type": "manual",
  "assigned_for_date": "2025-03-18"
}
```

- `assigned_for_date` defaults to today if omitted
- `source_type` defaults to `manual` if omitted

Behavior:

- look up or create a `study_item` matching `(surface_form, selected_reading, dictionary_entry_id)`
- populate `study_item_kanji` if the study item is newly created
- create a `daily_assignment` with status `pending` and origin derived from `source_type`

Response (201 Created):

```json
{
  "study_item": {
    "id": 1,
    "surface_form": "食べる",
    "selected_reading": "たべる",
    "dictionary_entry_id": 1358280,
    "source_type": "manual",
    "created_at": "2025-03-18T10:00:00.000Z",
    "is_new": true
  },
  "assignment": {
    "id": 1,
    "study_item_id": 1,
    "assigned_for_date": "2025-03-18",
    "status": "pending",
    "origin": "manual",
    "created_at": "2025-03-18T10:00:00.000Z"
  }
}
```

- `study_item.is_new` indicates whether the study item was just created (`true`) or already existed and was reused (`false`)

### Assignments

#### `GET /assignments?status=pending&date=YYYY-MM-DD`

Returns assignments for a given date, filtered by status. Both params are optional: omitting `date` returns all dates, omitting `status` returns all statuses.

Response:

```json
{
  "assignments": [
    {
      "id": 1,
      "study_item_id": 1,
      "assigned_for_date": "2025-03-18",
      "status": "pending",
      "origin": "manual",
      "time_spent_ms": null,
      "created_at": "2025-03-18T10:00:00.000Z",
      "completed_at": null,
      "study_item": {
        "surface_form": "食べる",
        "selected_reading": "たべる",
        "first_gloss": "to eat"
      }
    }
  ]
}
```

- `study_item.first_gloss` is the first English gloss from the first sense of the linked dictionary entry

#### `GET /assignments/backlog`

Same response shape as the assignments list above, but returns all incomplete assignments (`status` in `pending`, `skipped`) across all dates, ordered oldest `assigned_for_date` first.

#### `GET /assignments/:id/drill`

Returns the full data payload needed to render the drill screen for a single assignment.

Response:

```json
{
  "assignment": {
    "id": 1,
    "assigned_for_date": "2025-03-18",
    "status": "pending",
    "origin": "manual"
  },
  "study_item": {
    "id": 1,
    "surface_form": "食べる",
    "selected_reading": "たべる"
  },
  "dictionary_entry": {
    "id": 1358280,
    "is_common": true,
    "primary_spelling": "食べる",
    "primary_reading": "たべる",
    "senses": [
      {
        "sense_index": 0,
        "glosses": ["to eat"],
        "parts_of_speech": ["Ichidan verb", "Transitive verb"]
      }
    ]
  },
  "kanji": [
    {
      "literal": "食",
      "position": 0,
      "meanings": ["eat", "food"],
      "onyomi": ["ショク", "ジキ"],
      "kunyomi": ["く.う", "く.らう", "た.べる", "は.む"],
      "stroke_count": 9,
      "grade": 2,
      "stroke_asset_url": "/static/kanji-svg/098df.svg"
    }
  ],
  "queue": {
    "current_index": 0,
    "total": 5,
    "next_assignment_id": 2,
    "prev_assignment_id": null
  }
}
```

- `kanji` is an array ordered by `position` from `study_item_kanji`. Empty array for kana-only words.
- `stroke_asset_url` is the full URL path the frontend can use directly in an `<img>` or inline SVG fetch. Null if no stroke asset exists for that kanji.
- `queue` provides navigation context when drilling a sequence of assignments. `next_assignment_id` is null when this is the last item.

Queue construction: the queue is determined by the drill entry point and passed as a query parameter:

- `/drill?date=2025-03-18` → queue is all pending assignments for that date, ordered by `created_at` ASC
- `/drill?backlog=true` → queue is all incomplete assignments across all dates, ordered by `assigned_for_date` ASC then `created_at` ASC
- `/drill/:assignmentId` (no query params) → queue of one (single item drill)

The API's `GET /assignments/:id/drill` endpoint accepts an optional `queue_source` query param (`today`, `backlog`, or omitted for single) and uses it to compute the `queue` navigation fields. This way the frontend doesn't need to manage the queue client-side — the API returns the next/prev IDs based on the same query that built the queue.

#### `POST /assignments/:id/complete`

Request body:

```json
{
  "time_spent_ms": 45000
}
```

Response:

```json
{
  "assignment": {
    "id": 1,
    "status": "completed",
    "time_spent_ms": 45000,
    "completed_at": "2025-03-18T10:05:00.000Z"
  }
}
```

#### `POST /assignments/:id/skip`

Request body (optional):

```json
{
  "time_spent_ms": 5000
}
```

`time_spent_ms` is optional — the user may have spent time viewing the word before deciding to skip. If provided, it is recorded on the assignment.

Response: same shape as complete, with `status: "skipped"` and no `completed_at`.

#### `POST /assignments/:id/reopen`

No request body required. Sets status back to `pending`, clears `completed_at` and `time_spent_ms`.

Note: this deliberately discards the previous completion data. Once event logging is active (Phase 4b), the `completed` and `reopened` events preserve the full history. For MVP, the trade-off of simplicity over data preservation is acceptable since reopen will be rare.

Response: same shape as complete, with `status: "pending"`.

### Sessions / Events (Phase 4b)

These endpoints are deferred to Phase 4b. Included here for completeness.

#### `POST /sessions`

Request body:

```json
{
  "mode": "today"
}
```

Response:

```json
{
  "session": {
    "id": 1,
    "started_at": "2025-03-18T10:00:00.000Z",
    "mode": "today"
  }
}
```

#### `POST /sessions/:id/end`

No request body required. Sets `ended_at` to now.

#### `POST /events`

Request body:

```json
{
  "study_item_id": 1,
  "daily_assignment_id": 1,
  "study_session_id": 1,
  "event_type": "completed",
  "duration_ms": 45000
}
```

Response:

```json
{
  "event": {
    "id": 1,
    "occurred_at": "2025-03-18T10:05:00.000Z"
  }
}
```

### Stats

#### `GET /stats/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD`

Query params are optional. Defaults to the last 365 days.

Response:

```json
{
  "today": {
    "total": 5,
    "pending": 3,
    "completed": 2
  },
  "overdue": {
    "total_pending": 12,
    "oldest_date": "2025-02-01"
  },
  "totals": {
    "total_time_ms": 3600000,
    "total_completed": 150,
    "avg_time_per_assignment_ms": 24000
  },
  "heatmap": [
    {
      "date": "2025-03-18",
      "total_assignments": 5,
      "completed_count": 5,
      "pending_count": 0,
      "skipped_count": 0,
      "total_time_ms": 120000,
      "is_fully_completed": true
    }
  ]
}
```

#### `GET /stats/study-items/:id`

Response:

```json
{
  "study_item": {
    "id": 1,
    "surface_form": "食べる",
    "selected_reading": "たべる"
  },
  "stats": {
    "total_assignments": 5,
    "times_completed": 4,
    "total_time_ms": 180000,
    "avg_completion_time_ms": 45000,
    "first_assigned": "2025-01-15",
    "last_assigned": "2025-03-18"
  },
  "recent_assignments": [
    {
      "id": 10,
      "assigned_for_date": "2025-03-18",
      "status": "pending",
      "time_spent_ms": null,
      "completed_at": null
    }
  ]
}
```

#### `GET /stats/kanji/:literal`

Response:

```json
{
  "kanji": {
    "literal": "食",
    "meanings": ["eat", "food"],
    "onyomi": ["ショク", "ジキ"],
    "kunyomi": ["く.う", "く.らう", "た.べる", "は.む"],
    "stroke_count": 9,
    "grade": 2,
    "jlpt_level": 4,
    "frequency_rank": 328,
    "stroke_asset_url": "/static/kanji-svg/098df.svg"
  },
  "stats": {
    "word_count": 3,
    "total_assignments": 8,
    "times_drilled": 6
  },
  "study_items": [
    {
      "id": 1,
      "surface_form": "食べる",
      "selected_reading": "たべる"
    }
  ]
}
```

### Config (Phase 6)

These endpoints are deferred to Phase 6.

#### `GET /config`

Returns current app configuration.

#### `PUT /config/anki`

Updates Anki integration settings (trigger rules, etc.).

## Frontend Routing

Use React Router for client-side routing. Suggested routes:

- `/` — Dashboard
- `/intake` — Intake Screen
- `/today` — Today View
- `/backlog` — Backlog View
- `/drill/:assignmentId` — Drill Screen (single assignment) or `/drill?date=YYYY-MM-DD` to start a queue for a given date
- `/settings` — Settings / Data Sources

## Frontend Screens

## 1. Dashboard

Primary landing page.

Should show:

- today assignment count
- overdue assignment count
- oldest overdue date
- total time spent drilling
- average time per assignment
- heatmap/calendar view
- quick links to `Today` and `Backlog`

The heatmap should represent assignment completion over time and surface useful hover details such as:

- assignments for that date
- how many were completed
- total time spent
- whether the date was fully completed

## 2. Intake Screen

Manual add flow.

Should support:

- paste/type a word
- show dictionary search results
- resolve ambiguity via dropdown/list
- confirm and create assignment

## 3. Today View

List of assignments with `assigned_for_date = today` and incomplete status.

Should allow:

- start drill flow
- inspect item details
- mark completion from drill flow

## 4. Backlog View

List of all incomplete assignments across all dates.

Should support:

- oldest-first sorting by default
- filtering by date, word, or kanji
- entering drill mode directly
- quick visibility into how overdue each item is

This screen is essential, not optional.

## 5. Drill Screen

Single focused drill experience.

Layout:

- top: word displayed with the full kana reading shown above the entire word using `<ruby>` markup (no per-character furigana alignment — this is a supplementary tool for previously-seen words, so whole-word reading is sufficient and avoids morphological analysis complexity), plus selected reading and short English gloss
- main: one section per kanji with meanings/readings/stroke-order SVG
- bottom: timer and actions such as `Complete` and `Skip`

Behavior (Phase 4 — simplified, no event logging):

- record elapsed time per item on the client
- on `Complete`: update `daily_assignment.status` to `completed`, set `completed_at` and `time_spent_ms`
- on `Skip`: update `daily_assignment.status` to `skipped`
- advance to next assignment in the queue

Event logging (`study_event` writes for `shown`, `completed`, `skipped`, etc.) is deferred to a follow-up phase to keep the initial drill implementation focused.

## 6. Settings / Data Sources

Should eventually show:

- app version
- data source attribution/licenses
- configurable Anki trigger rules

## Visual Direction

- Keep the interface clean and highly readable.
- Use a restrained Japanese-inspired visual identity rather than a generic dashboard aesthetic.
- Prioritize mobile/tablet usability because manual entry and review may happen away from the desktop.

## Stats To Support

The schema should make these easy to derive later:

- total drill time
- average time per assignment
- assignments completed per day
- missed/incomplete assignments per day
- oldest overdue assignment
- most-drilled words
- words with the longest average completion time
- most-seen kanji
- repeat count per `study_item`
- interval between repeated assignments of the same `study_item`
- completion lateness (`completed_at - assigned_for_date`)

## Implementation Phases

## Phase 0 - Project Setup

- initialise git repo and `pnpm-workspace.yaml` with workspace entries: `apps/*`, `packages/*`
- create the four workspace packages: `apps/api`, `apps/web`, `packages/shared`, `packages/importer`
- each package gets its own `package.json` and `tsconfig.json`; the root has a base `tsconfig.json` with shared compiler options and project references
- install core shared dependencies: `typescript`, `zod`, `drizzle-orm`, `better-sqlite3`, `@types/better-sqlite3`, `drizzle-kit`
- install API dependencies in `apps/api`: `fastify`, `@fastify/static`
- install frontend dependencies in `apps/web`: `react`, `react-dom`, `react-router-dom`, `vite`, `@vitejs/plugin-react`
- set up ESLint and Prettier with a root config
- add a root `dev` script that runs the API and web dev servers concurrently
- define shared domain types, enums, and `zod` schemas in `packages/shared` — at minimum: `AssignmentStatus`, `AssignmentOrigin`, `SourceType`, `EventType` enums plus zod schemas for the intake request body and assignment API responses

## Phase 1 - Database And Importer

Split into sub-phases to manage complexity.

### Phase 1a - Schema And Migrations

- define all Drizzle schema files for reference and user study tables
- generate and run initial migrations
- create SQLite VIEWs (`v_day_summary`, `v_study_item_stats`, `v_kanji_stats`, `v_backlog_summary`)
- add indexes on `entry_spelling(text)` and `entry_reading(text)` for search
- verify the schema is correct with a small manual insert/query test

Deliverable: empty but fully migrated database with all tables, views, and indexes.

### Phase 1b - KANJIDIC2 Importer

- start with the smaller dataset to validate the import pipeline
- parse KANJIDIC2 XML, extract kanji metadata
- batch insert into `kanji` table within transactions
- add basic sanity checks (expected row count, spot-check known kanji)

Deliverable: `kanji` table populated with ~13,000 entries.

### Phase 1c - JMdict Importer

- parse JMdict XML using a streaming parser (e.g. `sax`) to avoid high memory usage
- batch insert in transactions of 1000-5000 entries
- populate `dictionary_entry`, `entry_spelling`, `entry_reading`, `entry_reading_spelling`, `entry_sense`
- correctly handle `re_restr` reading restriction elements
- add sanity checks (total entry count, spot-check common words like 食べる, 走る)

Deliverable: ~200,000 dictionary entries with spellings, readings, and senses searchable by index.

### Phase 1d - KanjiVG Importer

- extract SVG files from KanjiVG source to `data/kanji-svg/{codepoint}.svg` on disk
- use 5-digit zero-padded hex Unicode codepoint as filename (e.g. `098df.svg` for 食 U+98DF, `09913.svg` for 餓 U+9913)
- populate `kanji_stroke_asset` table with relative paths
- only create asset records for kanji that exist in the `kanji` table
- verify a sample of SVG files render correctly

Deliverable: ~11,000 SVG files on disk, `kanji_stroke_asset` table populated, ready for static serving.

## Phase 2 - Dictionary Lookup And Manual Intake

- build search endpoints (`GET /dictionary/search`, `GET /dictionary/entries/:id`)
- build result ranking/preselection rules (common words first, exact matches before prefix)
- build manual intake UI (search, candidate list, reading selection, confirm)
- implement `POST /study-items/intake`: create or reuse `study_item`, populate `study_item_kanji`, create `daily_assignment`
- set up static file serving for `data/kanji-svg/` directory on the Fastify server

Note: event logging for intake actions is deferred to Phase 4b.

Deliverable:

- manually add a difficult word and create an assignment for it

## Phase 3 - Assignment Views And Backlog

- build Today view
- build Backlog view
- build assignment filters/sorting
- ensure overdue items remain visible

Deliverable:

- browse and select incomplete work across dates

## Phase 4 - Drill Experience

- build drill screen layout (word with whole-word ruby reading, gloss, kanji panels)
- render KanjiVG stroke-order SVGs via static file URLs
- implement client-side timer per assignment
- implement `Complete` action: update assignment status, set `completed_at` and `time_spent_ms`
- implement `Skip` action: update assignment status
- implement queue navigation (advance to next assignment, handle end-of-queue)

Deliverable:

- complete actual drilling flows with time tracking and assignment status updates

Note: session management (`study_session`) and event logging (`study_event`) are deferred to Phase 4b to keep initial scope focused.

## Phase 4b - Session And Event Logging

- implement session create/end lifecycle
- add event logging on drill actions (`shown`, `completed`, `skipped`)
- backfill intake actions to write events (`added_manual`, `assignment_created`)
- wire events into stats views

Deliverable:

- full append-only event trail for all drill and intake actions

## Phase 5 - Dashboard And Reporting

- build summary queries/views
- build heatmap/calendar
- add total time and completion stats
- add top words/kanji panels
- add overdue summary cards

Deliverable:

- useful dashboard for progress and missed work

## Phase 6 - Settings And Anki Integration

- add app config storage/UI
- define configurable Anki trigger rules
- prototype Anki intake shape
- use card-provided reading when available
- create unresolved intake flow for ambiguous cases if needed

Deliverable:

- companion integration path without changing the core data model

## Main Risks And Mitigations

### 1. Entry Matching Is Harder Than It Looks

Risk:

- the same surface form may map to several entries/readings

Mitigation:

- resolve ambiguity explicitly at intake time
- use supplied readings from Anki when available

### 2. Inflected / Kana-Only Forms

Risk:

- manual input may not always directly match imported forms

Mitigation:

- support exact and prefix matching first
- add targeted normalization/deinflection later only if it becomes a real problem

### 3. Stats Regret

Risk:

- if only aggregates are stored, future reporting becomes brittle

Mitigation:

- the `study_event` table schema is created in Phase 1 migrations so it is ready when needed
- `daily_assignment` tracks `time_spent_ms`, `completed_at`, and `status` transitions directly, which is sufficient for core stats before event logging is wired up
- event logging is added in Phase 4b; until then, stats are derived from `daily_assignment` fields
- derive long-term stats from `study_event` once it is populated

### 4. Stroke Rendering Scope Creep

Risk:

- animated or highly polished stroke visuals can consume a lot of time

Mitigation:

- start with straightforward SVG rendering
- treat advanced animation as a later enhancement

### 5. Drizzle ORM Limitations With Composite Keys And Views

Risk:

- Drizzle's SQLite adapter has varying levels of support for composite primary keys and SQLite VIEWs in migrations
- VIEWs may need to be managed outside of Drizzle's generated migrations

Mitigation:

- test composite PK support early in Phase 1a with a minimal schema
- if Drizzle's migration tooling cannot create VIEWs, manage them via custom SQL migration files alongside the generated ones
- keep a fallback plan of raw SQL for the view definitions if needed

### 6. Dataset Licensing Oversight

Risk:

- forgetting attribution or source tracking

Mitigation:

- build attribution into the app and repo early

## Final Recommendations For The Coding Agent

- Optimize for correctness of intake and backlog handling before visual polish.
- Keep `study_item` persistent and `daily_assignment` repeatable.
- Preserve both assigned date and actual completion timestamp everywhere they matter.
- Treat incomplete assignments as first-class product entities.
- Build from open source datasets directly, not scraped/embedded Jisho UI.
- Capture raw events early so statistics remain flexible later.

## Immediate Next Step

Start with Phase 0 and Phase 1: scaffold the monorepo, define the schema, and get the importer working before building UI flows.
