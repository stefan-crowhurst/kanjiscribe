# is_fully_completed requires at least one completed assignment

## Context

The `v_day_summary` view historically marked a day as `is_fully_completed` whenever no `pending`/`skipped` rows remained — a rule that pre-dated the `archived` exit state and was already flagged in `PLAN.md` as a latent bug. Introducing removal (archive) makes the legacy rule routinely wrong: removing all assignments from a day would paint the heatmap green ("fully completed") despite zero study having happened.

## Decision

In migration `0002`, redefine `v_day_summary.is_fully_completed` so a day counts as fully completed **only when** it has at least one `completed` assignment **and** no `pending`/`skipped` assignments (archived rows excluded from the count entirely). Days reduced to zero assignments by removal become empty days, not completed days.

## Considered Options

- **A. Fix the view (chosen).** Put the `completed_count > 0` rider inside `v_day_summary`. The aggregate stays the single source of truth; frontend consumers (heatmap, dashboard) stop needing a per-consumer rider.
- **B. Leave the view, special-case the frontend.** Heatmap computes `is_fully_completed AND completed_count > 0`. Rejected: `PLAN.md` anticipated this rider but putting it in every consumer invites drift; a future stats page would silently re-introduce the bug.
- **C. Don't fix it for v1.** Rejected: removal makes the bug routine, not edge-case — it becomes a v1 bug.

## Consequences

- A new migration (`0002_fix_is_fully_completed_requires_completion.sql`) drops and recreates `v_day_summary`. SQLite views are cheap to recreate; no data movement.
- Empty-by-removal days will drop out of `v_day_summary` entirely (no row in the view), matching the documented "empty day" semantics. The heatmap renders such days as no-activity (blank), same as a day that never had assignments — not as green or "fully completed".
- Any future consumer of `is_fully_completed` inherits the corrected rule automatically.