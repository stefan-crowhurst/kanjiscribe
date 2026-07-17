# Never-drilled word estimate via per-kanji fallback chain

Status: ready-for-human

## Parent

`.scratch/time-to-finish-estimate/PRD.md`

## What to build

Extends `GET /estimates/today` (from issue 01) to handle never-drilled words using the 4-level per-kanji fallback chain, backed by the attribution infrastructure from issue 02.

For each pending/skipped assignment on today whose study item's `times_completed = 0`:

1. Look up the word's surface form and the positions + stroke counts of its kanji from `study_item_kanji` join `kanji`.
2. Run `computeWrites` (from issue 00) to get `per_char_writes` and `kana_writes_total`.
3. For each kanji in the word, run the 4-level fallback:
   - **Level 1** (`v_kanji_timing` has a row for this kanji): use `mean_per_write_time_ms`.
   - **Level 2** (no Level 1, but `v_stroke_count_bucket` has a row for this kanji's `stroke_count`): use that bucket's `mean_per_write_time_ms`.
   - **Level 3** (no Level 1 or 2, but `v_kanji_global_slope` has a row, i.e. any completion exists): use `ms_per_stroke * stroke_count`.
   - **Level 4 (floor)** (no completions anywhere — `v_kanji_global_slope` is empty): use the constant `0.5 * stroke_count * 1000` ms per write.
4. Multiply the per-write time for each kanji by its `per_char_writes` count to get that kanji's total contribution.
5. Add `kana_writes_total * 1000` (1 s per kana unit, including reading-writing writes).

The word's estimate is the sum across all kanji contributions plus the kana contribution. The endpoint's existing Level-0 path for previously-drilled words is unchanged — this issue only fills in the `times_completed = 0` branch that returned 0 in issue 01.

The per-stroke floor constant (0.5 s/stroke, 500 ms/stroke) is a code constant in the estimate module per ADR-0005 — not in `app_config`, not in a `.env`, not in a settings row.

### Backlog-day estimate pattern preview

This issue does not implement the backlog endpoints, but the per-word estimate logic it produces is the reusable unit that the next issue will call per-day. Keep the per-word estimation factored so a later per-day aggregation can call it without duplication — e.g. a `estimateAssignment(assignmentId)` helper that returns one assignment's estimate, used by both `/estimates/today` (sum over today's remaining) and later `/estimates/backlog-days` and `/estimates/backlog-day`.

## Acceptance criteria

- [x] `GET /estimates/today` returns a non-zero estimate for never-drilled words (no longer returns 0 for them as in issue 01).
- [x] A never-drilled word whose kanji all appear in `v_kanji_timing` uses each kanji's mean per-write time from that view (Level 1).
- [x] A never-drilled word whose kanji are not in `v_kanji_timing` but whose `stroke_count` appears in `v_stroke_count_bucket` uses the bucket's `mean_per_write_time_ms` (Level 2).
- [x] A never-drilled word whose kanji have no Level 1 or Level 2 data, but where `v_kanji_global_slope` has a row (at least one completion exists anywhere), uses `ms_per_stroke * stroke_count` per kanji (Level 3).
- [x] A never-drilled word where there are zero completions anywhere falls back to the constant `500 * stroke_count` ms per write (Level 4 / floor), per ADR-0005.
- [x] A multi-kanji word's estimate is the sum of each kanji's Level-1/2/3/4 estimate (the fallback level is evaluated per-kanji, not per-word — a word with one drilled kanji and one undrilled kanji uses Level 1 for the drilled kanji and Levels 2/3/4 for the other).
- [x] Kana-only never-drilled words return `kana_writes_total * 1000` ms (no per-kanji chain involved).
- [x] The per-stroke floor is a code constant (not read from `app_config` or environment variables).
- [x] The previously-drilled (Level-0) path from issue 01 still produces the same values for words with `times_completed >= 1` — this issue does not regress that path.
- [x] The endpoint still includes completed-actual `time_spent_ms` in the sum so the estimate drops as the user drills.
- [x] Tests at the existing `app.inject` seam cover each fallback level via seeded attribution rows; tests also cover the floor-constant path (zero completions anywhere) by ensuring no `kanji_attribution` rows exist.

## Blocked by

- `.scratch/time-to-finish-estimate/issues/01-previously-drilled-estimate-today-card.md` — extends that endpoint.
- `.scratch/time-to-finish-estimate/issues/02-attribution-infrastructure.md` — reads the `v_kanji_timing`, `v_stroke_count_bucket`, `v_kanji_global_slope` views.
- `.scratch/time-to-finish-estimate/issues/00-cell-model-pure-function.md` — uses `computeWrites` to get write counts and kana total.

## Comments

## Answer

Implemented `estimateAssignment(assignmentId)` in `apps/api/src/estimates.ts` and wired it into `GET /estimates/today` in `apps/api/src/server.ts`.

- The helper resolves per-kanji per-write times via the full 4-level fallback (Level-1 `v_kanji_timing`, Level-2 `v_stroke_count_bucket`, Level-3 `v_kanji_global_slope`, Level-4 floor constant `FLOOR_MS_PER_STROKE = 500`).
- Resolved per-write times are passed to `computeCellWrites` so remainder-cell tie-breaking uses the best-known times, not just stroke count.
- Kanji estimates are summed as `per_char_writes * per-write-ms`, then `kana_writes_total * 1000` is added.
- Completed assignments return actual `time_spent_ms`; previously-drilled pending/skipped assignments return `avg_completion_time_ms`; archived assignments return 0.
- `StudyItemKanji` was exported from `apps/api/src/attribution.ts` so the estimate module can type its kanji input explicitly.
- `apps/api/src/estimates-today.test.ts` now covers Level 1–4, multi-kanji mixed fallback, kana-only, remainder-cell tie-breaking, and aggregation, and the previously-drilled/completed-actual paths remain intact.

All API tests pass (57/57), `estimates-today.test.ts` passes (14/14), and typecheck passes for api, shared, and web.