# Attribution infrastructure: schema, write path, backfill

Status: ready-for-agent

## Parent

`.scratch/time-to-finish-estimate/PRD.md`

## What to build

End-to-end vertical slice for the **write path** that produces per-kanji per-write timing data: schema for the attribution table, the three rollup views, completion-time attribution row insertion, reopen-time row deletion, and the one-shot backfill over historical completions.

This slice adds no estimate endpoints and no new display surfaces — it gets the data into the DB and verified so the per-kanji fallback chain (a later slice) can read it.

### Schema migration 0003

New `kanji_attribution` table with `(assignment_id, kanji_literal, stroke_count, writes_count, attributed_time_ms REAL)` and a composite primary key on `(assignment_id, kanji_literal)`. Foreign keys reference `daily_assignment(id)` with `ON DELETE CASCADE` and `kanji(literal)`. Indexes on `kanji_literal` and `stroke_count` for the read-path views.

Three new views in the same migration:

- `v_kanji_timing` — per `kanji_literal`: `AVG(attributed_time_ms / writes_count)` as `mean_per_write_time_ms`. Level-1 data.
- `v_stroke_count_bucket` — per `stroke_count`: `AVG(attributed_time_ms / writes_count)` as `mean_per_write_time_ms` across all observations at that stroke count. Level-2 data.
- `v_kanji_global_slope` — singleton result: `SUM(attributed_time_ms) / SUM(writes_count * stroke_count)` as `ms_per_stroke`. Level-3 data.

`attributed_time_ms` is `REAL` because the stroke-weighted split produces fractional ms.

### Cell-model pure function (from issue 00) integration

The completion handler will use the pure function produced by issue 00 — `computeWrites(surface_form, kanji_with_strokes_and_per_write_times, selected_reading) → { per_char_writes, kana_writes_total }` — to compute the per-kanji write counts and total kana writes for the word being completed.

### Completion-time attribution

The existing `POST /assignments/:id/complete` handler gains, **in the same transaction** as the `UPDATE daily_assignment SET status='completed'`:

1. Look up the assignment's `study_item_id`, `surface_form`, `selected_reading`, and the kanji positions + stroke counts in the word (via `study_item_kanji` join `kanji` on `literal` — same shape as the drill payload's kanji fetch already uses).
2. Call `computeWrites` with the surface form, kanji positions/strokes, and reading to get `per_char_writes` and `kana_writes_total`.
3. Stroke-weighted attribution math:
   - `kana_time = kana_writes_total * 1000` (1 s per kana write, per `CONTEXT.md` kana unit term)
   - `kanji_pool = MAX(0, time_spent_ms - kana_time)`
   - If `kanji_pool = 0`: write no attribution rows — exclude the assignment from per-kanji attribution entirely (per ADR-0003, this avoids a fast/aborted timing pulling averages down).
   - Otherwise: `stroke_weight_total = SUM over each kanji k of (writes_count[k] * stroke_count[k])`, and for each kanji `attributed_time_ms = kanji_pool * (writes_count[k] * stroke_count[k]) / stroke_weight_total`. Insert one `kanji_attribution` row per kanji literal in the word.
4. Kanji missing from the `kanji` table (the existing intake path warns and skips) are also excluded from attribution — the consumed time falls into the kana-side subtraction or is silently absorbed by other kanji. This is the documented known limitation in the PRD; no special case here.

### Reopen-time deletion

The existing `POST /assignments/:id/reopen` handler gains, in the same transaction: `DELETE FROM kanji_attribution WHERE assignment_id = ?`. This removes the rows from the per-kanji means and the level-2/level-3 rollups, matching the semantic that reopen asserts "this timing shouldn't count" (per grilling Q6).

### Skip path

`POST /assignments/:id/skip` is unchanged for attribution. Skip writes no `kanji_attribution` rows (per grilling Q10 — only completed assignments write attribution). The existing `time_spent_ms` update on skip continues to happen; only the attribution side effect is absent.

### Archive and unarchive

`POST /assignments/:id/archive` and `POST /assignments/:id/unarchive` are unchanged. Archive only applies to `pending`/`skipped` assignments (never completed), so no attribution rows exist to clean up. Unarchive restores to pending and creates no attribution rows.

### Backfill migration 0004

One-shot migration that iterates every `daily_assignment` row with `status = 'completed'` and `time_spent_ms IS NOT NULL`, applies the same attribution math as the completion handler (cell model + stroke-weighted split), and inserts `kanji_attribution` rows. Gated on a metadata flag in `app_config` (e.g. `attribution_backfill_complete`) so it runs once on first deploy and is a no-op on subsequent migrations. Issued after migration 0003 so the table exists when the backfill runs.

The grilling session confirmed the user's reading-writing convention has been consistent across all historical use, so historical `time_spent_ms` values accurately reflect the cell model's assumptions and backfill cleanly.

### Test helper updates

`test-helpers.ts` gains helpers to seed `kanji` rows with stroke counts and `study_item_kanji` rows mapping positions to kanji literals (the existing `seedStudyItem` doesn't set these). The `resetDb()` wipe list (`test-helpers.ts:14-31`) gets `kanji_attribution` added so each test starts clean.

## Acceptance criteria

- [ ] Migration 0003 creates `kanji_attribution` with the documented columns, primary key, foreign keys, and indexes; and creates views `v_kanji_timing`, `v_stroke_count_bucket`, `v_kanji_global_slope` with the documented column shapes.
- [ ] `POST /assignments/:id/complete` on a multi-kanji word inserts `kanji_attribution` rows whose `attributed_time_ms` values sum to `MAX(0, time_spent_ms - kana_writes_total * 1000)`.
- [ ] `POST /assignments/:id/complete` on a kana-only word writes no `kanji_attribution` rows.
- [ ] `POST /assignments/:id/complete` on a fast timing (where `time_spent_ms < kana_writes_total * 1000`) writes no `kanji_attribution` rows (excluded).
- [ ] `POST /assignments/:id/complete` on a single-kanji word attributes 100% of the kanji pool to that kanji.
- [ ] `POST /assignments/:id/skip` writes no `kanji_attribution` rows, regardless of the `time_spent_ms` value provided.
- [ ] `POST /assignments/:id/reopen` deletes the `kanji_attribution` rows for the assignment in the same transaction; the views reflect the removal on the next read.
- [ ] `POST /assignments/:id/archive` and `POST /assignments/:id/unarchive` do not touch `kanji_attribution`.
- [ ] Backfill migration 0004 populates `kanji_attribution` rows for all pre-existing completed assignments with `time_spent_ms IS NOT NULL`; running it again (under the gating flag) is a no-op.
- [ ] `v_kanji_timing`, `v_stroke_count_bucket`, `v_kanji_global_slope` roll up correctly over seeded attribution rows: per-kanji mean per-write, per-stroke-count bucket mean, and singleton per-stroke ratio.
- [ ] Test helpers can seed `kanji` rows with stroke counts and `study_item_kanji` rows; `resetDb()` wipes the new table.
- [ ] Tests at the existing `app.inject` seam verify complete/reopen/skip side effects on `kanji_attribution` by inspecting the table contents after the call.

## Blocked by

- `.scratch/time-to-finish-estimate/issues/00-cell-model-pure-function.md` — needs `computeWrites` to run the attribution math.

## Comments

## Answer