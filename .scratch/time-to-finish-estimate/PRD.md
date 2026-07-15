# Time-to-finish estimate

Status: ready-for-agent

## Problem Statement

As a KanjiScribe user, when I look at my Today queue, my Backlog, or any individual day's queue, I have no idea how long the remaining drilling will actually take. I see "5 assignments remaining" but that gives me no sense of whether I'm looking at 90 seconds or 45 minutes — a word with a 14-stroke kanji takes dramatically longer than a 4-stroke one, and *I don't know in advance* until I sit down and start drilling. This makes it hard to decide whether I have time to drill right now, plan a session into my day, or gauge how far behind the backlog is drifting.

## Solution

Display an estimated **time-to-finish** next to each remaining-drilling surface: the Today card on the dashboard, the Backlog card on the dashboard (sum of all past overdue days), each day in the Backlog page, and on the Today page. Estimates are computed from a combination of actual recorded drilling time (for previously-drilled words) and a per-kanji stroke-time model (for words never drilled before). Estimates load non-blocking after each surface's primary render so the page is useful immediately and the time fills in when ready.

## User Stories

1. As a KanjiScribe user, I want to see an estimated time-to-finish on the Today card of the dashboard, so that I can decide if I have time to drill right now.
2. As a KanjiScribe user, I want to see an estimated time-to-finish on the Backlog card of the dashboard, so that I can gauge how far behind I'm drifting.
3. As a KanjiScribe user, I want to see an estimated time-to-finish next to each day on the Backlog page, so that I know which past day is cheap to clear and which one will eat my evening.
4. As a KanjiScribe user, I want to see an estimated time-to-finish on the Today page, so that I know how long today's remaining queue is before I hit Drill.
5. As a KanjiScribe user, I want previously-drilled words to use my average drilling time for those words, so that the estimate reflects my actual speed with familiar material.
6. As a KanjiScribe user, I want never-drilled words to use my past drilling time for kanji I've encountered in other words, so that the estimate reflects my actual handwriting speed per kanji.
7. As a KanjiScribe user, I want never-drilled words whose kanji I've never seen, but share a stroke count with kanji I have drilled, to be estimated from those same-stroke-count drilling times, so that the estimate respects how long strokes of that complexity take me.
8. As a KanjiScribe user, I want never-drilled words whose kanji I've never seen at any stroke count to be estimated from a default per-stroke time, so that even on a brand new install I see a plausible number.
9. As a KanjiScribe user, I want the estimate to reflect how many times each character in a word is written across the 10 writing cells, so that a word written 5 times cleanly is estimated to take ~5× as long as a word written once.
10. As a KanjiScribe user, I want the estimate to account for the reading-writing I do on the first clean copy of a word, so that the added time for writing out the kana reading isn't silently dropped on the floor.
11. As a KanjiScribe user, I want kana in a word to add 1 second each (per write), so that kana-heavy words aren't estimated as free.
12. As a KanjiScribe user, I want the estimate to round *up* where there's ambiguity, so that I'm pleasantly surprised rather than unpleasantly surprised when I sit down to drill.
13. As a KanjiScribe user who has never drilled any assignment, I want the estimate to use a sensible default seconds-per-stroke so that I don't see "0:00" or NaN before I have data.
14. As a KanjiScribe user, I want the time-to-finish to drop as I complete items in the queue, so that the displayed number mirrors my actual remaining work (rather than a fixed day-budget that ignores completed items).
15. As a KanjiScribe user, I want fully completed days to drop out of the Backlog card estimate entirely, so that the Backlog number reflects only work that's still owed.
16. As a KanjiScribe user, I want the Backlog card estimate to use only strictly past overdue days (matching the existing Overdue block semantics), so that today's leftover items don't double-count against the Backlog card (they're already on the Today card).
17. As a KanjiScribe user, I want each Backlog page per-day estimate to show that day's remaining (pending/skipped) items' estimated time, so that I can see day-by-day which past day is heaviest.
18. As a KanjiScribe user, when I reopen a completed assignment, I want its previously-attributed per-kanji timing data to be removed from the per-kanji averages, so that the estimates reflect only real completions.
19. As a KanjiScribe user, I want the estimate surface to render before the estimate request finishes, so that the page is interactive immediately and the estimate just fills in when ready.
20. As a KanjiScribe user, I want previously-drilled words that contain new kanji to still use the word's own average completion time, so that the actual recorded drilling time (which already captured all the nuances of writing that word) is preferred over a synthetic per-kanji estimate.
21. As a KanjiScribe user, I want a kanji that appears for the first time inside a previously-drilled word to still contribute its attribution to the per-kanji pool, so that *other* never-drilled words sharing that kanji can benefit the next time they're estimated.
22. As a KanjiScribe user, I want estimates to update live as I complete items within the current view (e.g. on Today), so that the displayed time-to-finish reflects what just got done rather than stale state from initial load.

## Implementation Decisions

### Architecture: write path and read path are separate modules

- **Write path** (completion event): a pure cell-model function computes per-character write counts and the kana-write total from `(surface_form, selected_reading, kanji stroke counts)`. A separate attribution function uses those counts plus the recorded `time_spent_ms` to compute per-kanji attributed times via stroke-weighted split. The completion handler persists `kanji_attribution` rows in the same transaction as the `UPDATE daily_assignment SET status='completed'`.
- **Read path** (estimate endpoints): a pure estimate function combines per-assignment estimates. For each pending/skipped assignment it either reads `v_study_item_stats.avg_completion_time_ms` (Level-0 drilled word) or queries per-kanji timings from views and runs the Level-1/2/3 fallback.

### Domain model: see `CONTEXT.md` and ADRs 0003, 0004, 0005

The grilling session produced 7 new `CONTEXT.md` glossary terms (time-to-finish estimate, writing cell model, reading-writing, per-kanji write time, per-stroke coefficient, kana unit, kanji attribution) and 3 ADRs:

- **ADR-0003** — stroke-weighted attribution (not equal split) for per-kanji timing.
- **ADR-0004** — attribution rows + SQL view rollups (not maintained rollup tables).
- **ADR-0005** — 0.5 s/stroke code constant as the zero-data floor, with research basis.

Implementers must read those before touching this feature; they're authoritative when prose in this PRD contradicts them.

### The 4-level fallback per assignment

For each pending/skipped assignment:

0. **Word previously drilled** (study item's `times_completed >= 1` in `v_study_item_stats`): use `avg_completion_time_ms` directly. Short-circuit; do not invoke per-kanji chain for this word's estimate.
1. **Kanji drilled before**: per-kanji mean per-write time from `v_kanji_timing(mean per_write_time_ms)` view.
2. **Kanji not drilled, siblings at same stroke count exist**: `v_stroke_count_bucket` view mean attributed per-write time at that stroke count.
3. **No same-stroke-count siblings**: global per-stroke ratio from singleton `v_kanji_global_slope` view × stroke count.
4. **No completions anywhere** (only state where the floor applies): the constant 0.5 s/stroke × stroke count.

Multi-kanji never-drilled words: each kanji estimated independently via Level-1/2/3, then summed; kana time is added per the kana-unit rule.

### The writing cell model

A pure function `(surface_form: string, kanji_positions: Array<{position, stroke_count}>, selected_reading: string) => { per_char_writes: Map<position, count>, kana_writes_total: number }`. Algorithm:

1. Walk surface form left-to-right. Each kanji occupies 1 cell. Adjacent runs of non-kanji ("kana units" — hiragana, katakana, Latin, digits, punctuation) pair into cells of ≤2.
2. `cell_cost = total cells for one clean copy`. `N = floor(10 / cell_cost)`. `remainder_cells = 10 − N · cell_cost`.
3. Write each kanji and each non-kanji character once per clean copy → N writes per character.
4. Fill remainder cells with the **highest-write-time-first** characters:
   - Kanji first, one per cell, repetition allowed. Tie-break: longest known per-write time (from views), else leftmost.
   - Kana units second (only if word has no kanji, or remainder exceeds the kanji set), 2 per cell.
5. **Reading-writing first-copy add**: add `len(selected_reading)` kana-unit writes to `kana_writes_total`. This is the only place reading kana enters the model — first clean copy only, one full pass of the reading regardless of what's in the surface form.
6. `cell_cost > 10` case: N = 0, fill all 10 cells with the remainder-fill rules.

### The attribute-at-completion math

At completion of an assignment with `time_spent_ms = T`:

```
total_kana_writes = (surface_kana_writes + len(selected_reading))
kana_time = total_kana_writes × 1000  // 1 s per kana write
kanji_pool = max(0, T - kana_time)
if (kanji_pool === 0) -> exclude assignment from per-kanji attribution entirely (no rows written)
else:
  stroke_weight_total = Σ over each kanji k of (writes_count[k] × stroke_count[k])
  attributed_time[k] = kanji_pool × (writes_count[k] × stroke_count[k]) / stroke_weight_total
  // one kanji_attribution row per kanji literal in the word, attributed_time_ms = attributed_time[k]
  // writes_count[k] is the number of times that kanji is written in the 10-cell layout
```

Key edge cases (all already in ADR-0003):
- `T < kana_time` → exclude; do not write attribution rows (avoids the kanji averaging down a fast/aborted timing).
- Kana-only word → no kanji pool to split, contributes nothing to per-kanji attribution (its estimate uses the kana rule only).
- Single-kanji word → 100% to that kanji (weighting is trivially uniform).
- Kanji missing from the `kanji` table (silent skip at intake, see server's existing `isKanjiChar` check and the warn-and-skip path) — the kanji is excluded from cell-model attribution for that word. **Known limitation**; documented separately, not special-cased. Fix by re-importing the kanji table.

### Schema changes

New table (migration `0003`):

```
CREATE TABLE kanji_attribution (
  assignment_id INTEGER NOT NULL,
  kanji_literal TEXT NOT NULL,
  stroke_count INTEGER NOT NULL,
  writes_count INTEGER NOT NULL,
  attributed_time_ms REAL NOT NULL,
  PRIMARY KEY (assignment_id, kanji_literal),
  FOREIGN KEY (assignment_id) REFERENCES daily_assignment(id) ON DELETE CASCADE,
  FOREIGN KEY (kanji_literal) REFERENCES kanji(literal)
);
CREATE INDEX idx_kanji_attribution_literal ON kanji_attribution(kanji_literal);
CREATE INDEX idx_kanji_attribution_stroke_count ON kanji_attribution(stroke_count);
```

Note `attributed_time_ms` is REAL because the stroke-weighted split produces fractional ms; the views round appropriately when exposing means.

New views (same migration):

- `v_kanji_timing` — per `kanji_literal`: `AVG(attributed_time_ms / writes_count)` as `mean_per_write_time_ms`. This is Level-1 data.
- `v_stroke_count_bucket` — per `stroke_count`: `AVG(attributed_time_ms / writes_count)` as `mean_per_write_time_ms` across all observations at that stroke count. This is Level-2 data.
- `v_kanji_global_slope` — single row: `SUM(attributed_time_ms) / SUM(writes_count × stroke_count)` as `ms_per_stroke`. This is Level-3 data.

### API contracts

Three new read-path endpoints, all returning raw milliseconds (no rounding at the API; rounding is a display-layer concern):

- `GET /estimates/today` — returns `{ estimated_remaining_ms: number }` for today's pending+skipped assignments (sum over each remaining assignment's Level-0 or Level-1/2/3 estimate). Completed assignments on today contribute their actual `time_spent_ms` to the total.
- `GET /estimates/backlog-days` — returns `{ estimated_remaining_ms: number }` for the **strictly past** overdue assignments (matching the existing `overdue` block: `status IN ('pending','skipped') AND assigned_for_date < today`). Sum across all past days.
- `GET /estimates/backlog-day?date=YYYY-MM-DD` — returns `{ estimated_remaining_ms: number }` for the remaining assignments of a single specific past day. Used by the Backlog page for per-day rendering.

Response shape is uniform: every endpoint returns `{ estimated_remaining_ms: number }`. A `ready: false` state for the API is unnecessary — frontends display the loaded number or nothing, depending on whether the request has completed.

`app_config` is not used. HTTP cache headers are not set — every request recomputes by reading the views; matches every other stats endpoint in the codebase (which already GROUP BY against `daily_assignment` on every load with no `ETag`/`Cache-Control`).

### Write-path integration

The existing `POST /assignments/:id/complete` handler currently just runs an `UPDATE`. It gains, **in the same transaction**:

1. Look up the assignment's `study_item_id`, `surface_form`, `selected_reading`, and the positions + stroke counts of the kanji in the word (via `study_item_kanji` join `kanji` on `literal` — same shape as the drill payload's kanji fetch already uses).
2. Call the pure cell-model function with those inputs to get `per_char_writes` and `kana_writes_total`.
3. Call the attribution function with `(T, per_char_writes, kana_writes_total, stroke_counts)` to get per-kanji attributed times.
4. If `kanji_pool > 0`, INSERT one `kanji_attribution` row per kanji literal in the word.

Skipped time is **never** attributed (per grilling Q10). `POST /assignments/:id/skip` continues to update `time_spent_ms` but writes no attribution rows.

The existing `POST /assignments/:id/reopen` handler gains, in the same transaction: `DELETE FROM kanji_attribution WHERE assignment_id = ?`.

`POST /assignments/:id/archive` and `POST /assignments/:id/unarchive` are unchanged for attribution — archive only applies to `pending`/`skipped` anyway (never completed), and unarchive restores to pending, so neither path intersects attribution rows.

### Backfill migration `0004`

A one-shot backfill on first deploy of this feature. Iterates every `daily_assignment` row with `status = 'completed'` and `time_spent_ms IS NOT NULL`, applies the same attribution math as the completion handler, and INSERTs `kanji_attribution` rows. Gated on a metadata flag in `app_config` (e.g. `attribution_backfill_complete: true`) so it runs once and is a no-op on subsequent migrations. The user's reading-writing behavior has been consistent with what the cell model assumes, so historical `time_spent_ms` values backfill cleanly — established during grilling.

### Display layer changes

A new pure util `formatMsEstimate(ms: number): string` alongside the existing `formatMs`. It uses `Math.ceil` on the seconds component (vs `formatMs`'s `Math.floor`). The existing `formatMs` is unchanged — actual recorded times on the DrillPage footer and Dashboard "Today Time" card keep flooring, only *estimates* round up.

Rounding composition (confirmed during grilling):
- Backlog card: sum raw per-day `ms` across all past days, then `formatMsEstimate` the grand total.
- Backlog page per-day row: `formatMsEstimate` the single day's raw `ms`.
- Today card and Today page: `formatMsEstimate` the request's raw `ms`.

### Frontend non-blocking loads

Every estimate surface renders fully before the estimate request resolves. Concretely:

- **Dashboard card (Today / Backlog):** the page already does `Promise.all` for stats on mount. The estimate fetch runs in a new `useEffect` that's started alongside the stats fetch but with a separate state slot. The card renders its other content immediately; an estimate placeholder (e.g. "—" or "loading…") appears in the time slot and is replaced when the estimate request resolves.
- **Today page:** same pattern.
- **Backlog page:** the day list renders from `/assignments/backlog` immediately; a *separate* estimate request (which may be `Promise.all` over per-day calls, or a single batch endpoint if implementation finds that simpler) fills in estimates per-day as they resolve. Each day row shows its existing stats first; the estimate cell fills in when ready.

This non-blocking choice was explicitly confirmed during grilling — the user preferred the Today card to load without the estimate initially and re-render when the estimate request completes, rather than delay the entire card render.

## Testing Decisions

### Two seams

1. **HTTP integration via `app.inject` (existing seam).** Tests seed the DB directly via `test-helpers.ts` (`seedStudyItem`, `seedAssignment`) and assert on endpoint response bodies. Covers the write path (completing writes `kanji_attribution` rows; reopen deletes them; skip writes nothing) and the read path (estimate endpoints return correct values given seeded assignments + attribution). Prior art: `dashboard-today-counts.test.ts`, `assignments-query.test.ts`, `archive.test.ts`.
2. **Pure unit tests for the cell-model pure function (new, lowest-possible seam).** Direct function calls with `(surface_form, kanji_positions, stroke_counts, selected_reading)`, assert on `{ per_char_writes, kana_writes_total }`. Covers the dense edge-case space that would be impractical to drive through the full HTTP+DB seam: adjacent-kana pairing, kanji+kana adjacent runs, single-kanji words, kana-only words, single-cell remainder, multi-cell remainder, kanji repetition for remainder, kana-pairing into remainder cells, reading-writing first-copy adds, `cell_cost > 10` remainder fallback, mixed Latin/digits/punctuation among kana units.

No unit tests for the attribution function or the estimate function are in the seam plan as of PRD time — those are exercised through the HTTP seam via `kanji_attribution` row inspection and endpoint assertions. If bugs surface that demand a finer-grained attribution/estimate seam, that's a refinement the implementer can add; the cell model is the only part dense enough to demand isolation from day one.

### What makes a good test for this feature

External behavior, not implementation. Tests should assert on:

- **HTTP seam:** response body shapes (`estimated_remaining_ms` numeric), response codes (409s unchanged), side-effect-visible DB state (`SELECT FROM kanji_attribution` to confirm rows exist / are gone after complete / reopen). Don't assert on internal function call order or private helpers.
- **Cell-model seam:** the returned `per_char_writes` and `kana_writes_total` for representative inputs covering each edge case. Don't assert on internal iteration order or working arrays.

### Test data setup

`test-helpers.ts` already seeds `study_item` and `daily_assignment`. To estimate attribution correctness it needs to seed `kanji` (for stroke counts) and `study_item_kanji` (for the kanji-by-position lookup) — small additions to the existing helpers. The `resetDb()` wipe list (`test-helpers.ts:14-31`) needs `kanji_attribution` added so each test starts clean.

### Critical test scenarios (representative, not exhaustive)

- Undrilled word with never-seen kanji, no completions anywhere → estimate uses 0.5 s/stroke × stroke_count × per-char writes + kana time.
- Undrilled word with never-seen kanji, after one completion of a different word → estimate uses global per-stroke ratio instead of floor.
- Previously-drilled word → estimate uses `avg_completion_time_ms`, kanji_attribution pool does not influence it.
- Completion of a word writes attribution rows with the correct stroke-weighted split.
- Completion of a kana-only word writes no attribution rows.
- Completion of a fast / under-kana-time word writes no attribution rows (excluded).
- Reopen of a completed word removes its attribution rows.
- Skip of an assignment writes no attribution rows.
- Backlog card estimate sums only strictly past pending/skipped assignments (today's leftover excluded).
- Backlog page per-day estimate returns only that day's remaining items.
- Reading-writing kana writes are included in the kana-time subtraction.
- Multi-kanji word estimate sums each kanji's individual estimate.

## Out of Scope

- **Missing-kanji handling.** A kanji missing from the `kanji` table (the existing intake path warns and skips) is excluded from attribution; the estimate pretends that kanji doesn't exist. This is a documented **known limitation**, tracked separately, fixed by re-importing the kanji data — not by adding special-case estimation.
- **Backfill with cutoff date** (`(C)` option from grilling Q12) — the grilling session confirmed the user's reading-writing behavior has been consistent, so a single full-history backfill is correct. A configurable cutoff is not built.
- **Maintained rollup tables for perf** (`(B)` option from grilling Q7) — persisted incremental aggregates are explicitly rejected in ADR-0004. Reconsider only if profiling over a concrete large install shows a real problem.
- **HTTP cache headers / ETag** — explicitly rejected during grilling (Q8); recompute on every request, matching every existing stats endpoint.
- **Estimated time on the Drill page** — the Drill page already shows actual elapsed and actual day total; no estimate is displayed there. Estimates are only on the four list-view surfaces.
- **Config surface for the per-stroke floor.** ADR-0005 fixes it as a code constant; an `app_config` row is not added.
- **Per-day estimate field on the existing `/assignments/backlog` `dayStats` response.** Grilling confirmed estimates load non-blocking, so the Backlog page reaches for a separate estimate call rather than bloating `dayStats` and delaying the main backlog render.
- **A "today's completed items contribute actual recorded time to Today card estimate" verification test through the HTTP seam.** The actual-recorded-time path on the Today card (a completed assignment's `time_spent_ms` adds into `estimated_remaining_ms`) is in scope and must be tested; this bullet just makes explicit that the test for it is via the HTTP seam (already covered by the seam plan), not via a new seam.

## Further Notes

### Provenance and references

- Research basis for the 0.5 s/stroke floor: Tamaoka, Phương, Zhang, Kawahara & Verdonschot (2026), *Frontiers in Language Sciences* — single-kanji handwriting durations among Vietnamese JFL learners on a stylus-on-tablet task, marginal ~380 ms per stroke. See ADR-0005 for the full reasoning and the 0.5 s/stroke upward adjustment.
- All grilling decisions are captured in `CONTEXT.md` (the 7 new terms) and ADRs 0003-0005. Implementers should treat those as authoritative; this PRD is a synthesis, but the model lives in those files.
- CONTEXT.md is devoid of implementation details per the domain-modeling skill; implementation specifics (the cell-model algorithm, the attribution math, the schema) live in this PRD and the ADRs.

### Migration ordering

- `0003` schema migration creates `kanji_attribution` table and the three rollup views.
- `0004` backfill migration runs against existing completed assignments and writes attribution rows. Must come after `0003` (needs the table). Gated on `app_config` flag so subsequent deploys skip it.
- Subsequent code (complete handler changes, reopen handler changes, estimate endpoints, frontend) lands independently of the migrations; the feature is wired up only when both migrations have applied and the code is deployed.

### The cell-model function is the highest-risk surface

The cell-model pure function is the most edge-case-dense piece of this feature. The grilling session resolved ~10 explicit edge cases (adjacent-kana pairing, remainder tie-breaks, kanji repetition in remainder, kana-only words, reading-writing first-copy adds, `cell_cost > 10`, mixed Latin/digits, single-character words). Testing this through HTTP would have each edge case require its own seeded DB scenario with dictionary entries, kanji with specific stroke counts, completion events, and endpoint calls — most of the test surface would be setup, not assertions. The pure-function unit seam is the one piece of this feature where the existing single-seam-testing pattern of the codebase is genuinely inadequate; the new seam is at the lowest possible point (no dependencies, no side effects) and doesn't introduce coupling for any other part of the feature.

### Frontend format util placement

`formatMsEstimate` lives next to `formatMs` in the web app's existing `lib/api.ts`. The two functions share a seconds-to-`M:SS` shape but differ in floor vs ceil; a small helper that does the shared seconds-formatting and takes the rounding mode as an argument is a reasonable implementation choice but not a PRD-level decision.

### No changes to existing state machine

The grilling session confirmed no new assignment states or transitions. `completed → pending` (reopen) already exists in CONTEXT.md; this feature piggy-backs an attribution-row-delete on that existing transition. No new ADR is needed for the state machine.