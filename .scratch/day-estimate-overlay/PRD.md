# Day estimate overlay on the Total Time chart

## Goal

Visually represent the **day estimate** (see `CONTEXT.md`) on the dashboard's Per-day Stats **Total Time** chart, so users can compare elapsed time against the planned total at a glance.

## Decisions (from grilling session)

- **Semantics**: the day estimate is the sum of `estimated_ms` (estimate snapshots) over a day's non-archived assignments — the target the **day estimate delta** is measured against. Over a strictly fully completed, fully snapshotted day, `day estimate delta = total_time_ms − day estimate`.
- **Scope**: the Total Time chart only. No changes to Words Completed, Avg Time per Word, day detail, or the heatmap.
- **Gating**: the estimate is drawn only for strictly fully completed (`is_fully_completed`) + fully snapshotted days, mirroring the `estimate_delta_ms` gate exactly. `NULL`/gap elsewhere — unfinished or legacy days keep just the actual-time bar. Server-side gate, no client-side rule duplication.
- **Encoding**: a dashed neutral-grey `Line` over the existing bar + solid red actual line; `connectNulls={false}` so gated-out days gap. Classic budget-vs-spend idiom.
- **Tooltip**: enriched to show Total time, Day estimate, and over/under delta when the estimate exists; unchanged on days without one. No legend.
- **Axis**: the y-axis max must account for estimate values so the dashed line is never clipped.
