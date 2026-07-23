# Estimate snapshots at creation + estimates served from snapshots

Status: ready-for-agent

## Parent

`.scratch/estimate-performance-delta/PRD.md`

## What to build

The plumbing slice that makes the **estimate snapshot** the single source of "the estimate" (see `CONTEXT.md`: estimate snapshot, time-to-finish estimate). Backend-only; behaviour of every surface is unchanged, but the estimate is now persisted per assignment instead of recomputed live.

End-to-end behaviour:

- A new migration adds a nullable integer `estimated_ms` column to `daily_assignment`. No backfill of any kind: all pre-existing rows keep `NULL` (including currently-pending ones — the forward-estimate undercount during transition is explicitly accepted, per PRD).
- `POST /study-items/intake`, after inserting the assignment and **in the same transaction**, computes the estimate with the existing `estimateAssignment` and writes it to `estimated_ms` (rounded to integer ms — the math produces fractions). For a fresh pending row this yields the Level-0 `avg_completion_time_ms` or the never-drilled fallback chain value.
- The intake endpoint's unarchive-reactivate path does NOT write a snapshot — the row keeps whatever `estimated_ms` it has. No status transition (reopen, skip, complete, archive, unarchive) ever recomputes it.
- The three estimate endpoints stop looping per-assignment through `estimateAssignment` and become single aggregate queries:
  - `GET /estimates/today` — sum of `time_spent_ms` over today's completed rows + sum of `estimated_ms` over today's pending/skipped rows; archived excluded; `NULL` snapshots contribute 0.
  - `GET /estimates/backlog-days` — sum of `estimated_ms` over strictly-past pending/skipped rows.
  - `GET /estimates/backlog-day?date=…` — sum of `estimated_ms` over that date's pending/skipped rows.
- `estimateAssignment` itself is unchanged (its completed/archived branches simply stop being exercised — leave intact).
- `GET /assignments` rows gain a nullable `estimated_ms` (this is what slice 2 renders from).

### Existing test rework

`estimates-today.test.ts` and `estimates-backlog.test.ts` seed via direct INSERT (→ `NULL estimated_ms`) and assert live-computed values; under SUM semantics they must seed through the intake endpoint, or the seed helper must accept an explicit `estimated_ms`. The helper INSERT gains the nullable column; `resetDb()` needs no change (the column lives on an existing wiped table).

## Acceptance criteria

- [ ] Migration adds nullable `estimated_ms` to `daily_assignment`; existing rows are `NULL` after migrating.
- [ ] Intake of a previously-drilled word stores `estimated_ms` equal to the item's current `avg_completion_time_ms` (integer ms).
- [ ] Intake of a never-drilled word stores `estimated_ms` equal to the fallback-chain estimate (the value the old endpoint would have returned for it).
- [ ] A pending assignment's `estimated_ms` does not change when other words are completed afterwards (no drift).
- [ ] Reopen then recomplete leaves `estimated_ms` unchanged; unarchive-reactivate via intake preserves whatever snapshot exists.
- [ ] `GET /estimates/today` returns actuals of completed + snapshots of pending/skipped; archived excluded; `NULL`-snapshot pending rows contribute 0.
- [ ] `GET /estimates/backlog-days` and `/estimates/backlog-day` return sums of snapshots over pending/skipped rows with unchanged date semantics.
- [ ] Response shapes (`{ estimated_remaining_ms: number }`) are unchanged; no cache headers added.
- [ ] `GET /assignments` rows include `estimated_ms` (null for legacy rows, value for new rows).
- [ ] Reworked estimate tests pass at the existing `app.inject` HTTP seam, plus new coverage for snapshot-at-creation, no-drift, reopen/unarchive preservation, and NULL-contributes-0.

## Blocked by

None - can start immediately.

## Comments

## Answer
