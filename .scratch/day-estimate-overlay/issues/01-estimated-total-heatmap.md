# Backend: gated `estimated_total_ms` on the dashboard heatmap

Status: ready-for-agent

## Parent

`.scratch/day-estimate-overlay/PRD.md`

## What to build

The dashboard heatmap gains a nullable **day estimate** (see `CONTEXT.md`): the sum of the day's `estimated_ms` estimate snapshots, gated server-side by exactly the same rule as `estimate_delta_ms`.

End-to-end behaviour:

- `GET /stats/dashboard` heatmap rows gain `estimated_total_ms: number | null`.
- The value is present only when the day `is_fully_completed` (strict — no pending, no skipped, at least one completed) **and** every completed assignment of the day has a non-null `estimated_ms` (full snapshot coverage). On such a day the non-archived set equals the completed set, so the day estimate is the sum of `estimated_ms` over the day's completed rows.
- `NULL` for any gate failure: pending remaining, skipped present, mixed legacy/snapshot coverage, all-legacy day, empty day — the same gate as `estimate_delta_ms`, computed in the same query (`day_completed` CTE + `CASE`).
- No client-side gate logic; the frontend consumes the field as-is.

## Acceptance criteria

- [ ] `day_completed` CTE sums `estimated_ms` per day over `status = 'completed'` rows.
- [ ] Heatmap rows include `estimated_total_ms`, non-null under exactly the same `CASE` as `estimate_delta_ms`.
- [ ] Gate failures all yield `null`: pending remaining; skipped present; mixed legacy/snapshot coverage; all-legacy day; empty day.
- [ ] On a gated day the field equals the sum of the per-word `estimated_ms` visible on that day, and `estimate_delta_ms = total_time_ms − estimated_total_ms` holds (both over and under cases).
- [ ] `estimated_total_ms: null` is typed `number | null` in the response; existing consumers (today/overdue/totals) are unaffected.
- [ ] Coverage at the existing `app.inject` HTTP seam: gated days (signed sums, both directions), every gate-failure case, and agreement with per-word data.

## Blocked by

None — can start immediately

## Answer

Implemented. `apps/api/src/server.ts`: added `SUM(estimated_ms) AS estimated_total_ms` to the `day_completed` CTE and a gated `estimated_total_ms` column using the same `CASE` as `estimate_delta_ms`. New `apps/api/src/day-estimate.test.ts` (9 tests) covers gated sums (over/under/zero), per-word agreement, the `estimate_delta_ms = total_time_ms − estimated_total_ms` identity, and all gate-failure cases. Typecheck, lint, and full suite (13 files / 91 tests) pass.
