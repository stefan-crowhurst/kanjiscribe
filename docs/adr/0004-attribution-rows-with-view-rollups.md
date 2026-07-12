# Per-kanji timing lives in attribution rows rolled up by SQL views, not maintained rollup tables

## Context

The per-kanji attribution model (ADR-0003) produces, for each completed assignment, one row per kanji in that word. Downstream reads need three aggregates: per-kanji mean per-write time, per-stroke-count bucket mean, and a global per-stroke ratio. The aggregates must stay correct as the underlying `daily_assignment` rows change (completions append rows; reopen removes them).

The cell-packing logic (10-cell layout, adjacent-kana pairing, remainder-fill rules, reading-writing) is TypeScript — it cannot be expressed as a SQL view, an SQL trigger, or a stored procedure. So the write path necessarily runs JS at completion time. The design question is the read-path shape: roll up fresh on every read, or maintain running totals that update on every write.

## Decision

Persist the atomic attribution rows in a `kanji_attribution` table. Roll up the three aggregates as SQL **views** (`v_kanji_timing` per-kanji mean, `v_stroke_count_bucket` per-stroke-count bucket mean, `v_kanji_global_slope` singleton ratio), exactly mirroring how the existing `v_study_item_stats`, `v_kanji_stats`, and `v_day_summary` views roll up over `daily_assignment` and `study_item_kanji` today.

The read path is plain `SELECT` against views. The write path is: complete assignment → JS computes `(surface_kana_writes, len(selected_reading), kanji_writes_per_kanji)` → INSERT attribution rows in the same transaction as the `UPDATE daily_assignment SET status='completed'`. Reopen: `DELETE FROM kanji_attribution WHERE assignment_id = ?` in the reopen transaction.

Backfill once over historical `completed` assignments on first deploy (the user's reading-writing convention has been consistent, so historical `time_spent_ms` already includes reading-writing time).

## Considered Options

- **A. Attribution rows + view rollups (chosen).** Mirrors every existing aggregate in the codebase (views over `daily_assignment` GROUP BY on every stats-request). Views are always current; no drift, no incremental maintenance, no reversal logic. Reopen is a single `DELETE` — the views recompute. The schema gains one table and three views; the write path gains one JS function called inside the completion transaction.
- **B. Maintained rollup tables.** A `kanji_timing_aggregate` table (per kanji: running sum + count), a `stroke_count_aggregate` table (per stroke count: running sum + count), and a singleton global-coefficient row. Updated on every completion (increment the rows), decremented on every reopen. Aggregates are read directly from the maintained rows. Rejected: carries incremental-state maintenance and decrement-on-reopen logic that the attributed-rows approach gets for free with a single `DELETE`. The perf win — skipping a GROUP BY SUM on read — is sub-millisecond at single-user scale and is already the accepted cost of every existing view in the codebase.
- **C. Recompute fully on every request from `daily_assignment`.** Rejected: the JS cell-model attribution would have to run across every completed assignment on every estimate request — far more expensive than reading pre-attributed rows. This is the only option that puts the JS attribution on the read path.

## Consequences

- A future engineer looking for a perf win can **promote any view to a maintained rollup table** without changing the estimate API — the view is the contract, the rollup is the implementation. A is not a one-way door in the read path; B is a one-way door in the write path (commits to decrement/reversal logic up front).
- Reopen is already a first-class state-machine move documented in `CONTEXT.md` ("Completed … can be `reopened` back to `pending`"). Treating it as a `DELETE` from attribution rows — rather than a decrement against running totals — keeps the reopen path the same shape as every other archive/delete in the codebase: the rows are the source of truth, the views reflect removal naturally.
- The codebase has no SQL triggers anywhere (`0001_initial.sql` uses indexes and views, no triggers). The decision keeps that invariant: attribution rows are written and deleted in app-transaction code, not by DB triggers. A reader who wonders "where do `kanji_attribution` rows come from?" follows app code, not DB plumbing.
- The first deploy of this feature must run the one-shot backfill migration over historical `completed` assignments. Subsequent deploys are no-ops for attribution backfill (the migration is gated on row-count or a metadata flag).