# Day verdict: gated day delta in dashboard payload + day header, Today Time card, Today page

Status: ready-for-agent

## Parent

`.scratch/estimate-performance-delta/PRD.md`

## What to build

The **day estimate delta** (see `CONTEXT.md`): the strictly-gated day-level verdict, computed server-side and rendered on the three day-level surfaces.

End-to-end behaviour:

- `GET /stats/dashboard` heatmap rows gain a nullable `estimate_delta_ms`. The gate is computed server-side: the value is present only when the day `is_fully_completed` (strict — no pending, no skipped, at least one completed) **and** every completed assignment of the day has a non-null `estimated_ms` (full coverage). The value is `SUM(time_spent_ms − estimated_ms)` over the day's completed snapshotted rows. `NULL` for any gate failure: legacy days, mixed-coverage days, days with pending/skipped remaining, empty days.
- **Day detail page header** shows the day delta (reusing the shared indicator from slice 2) when the day's row carries a value — the page already fetches the single-day dashboard range.
- **Dashboard Today Time card** shows today's day delta when today's row carries a value. Strictly gated like everything else — no mid-flight display; the verdict appears only once today is fully completed.
- **Today page** shows the day delta once today is fully completed, fetching the single-day dashboard range (same pattern as the day detail page) and rendering the shared indicator.
- All three surfaces render from the same server-computed field — no client-side gate logic, no duplicate rules.

## Acceptance criteria

- [ ] Dashboard heatmap rows include `estimate_delta_ms`: correct signed sum for fully completed, fully snapshotted days (both over and under cases).
- [ ] Gate failures all yield null: pending remaining; skipped present; mixed legacy/snapshot coverage; all-legacy day; empty day.
- [ ] Day detail header shows the day delta iff the day row carries a value; the number equals the sum of the per-word deltas visible on the same page.
- [ ] Today Time card shows the delta only once today is strictly fully completed; while work remains it renders as before.
- [ ] Today page shows the day delta once today is fully completed, from the same server field.
- [ ] Zero day delta renders via the neutral indicator; every surface agrees on sign and magnitude.
- [ ] Gate coverage at the existing `app.inject` HTTP seam: signed sums, each gate-failure case, and agreement with per-word data.

## Blocked by

- `.scratch/estimate-performance-delta/issues/01-estimate-snapshots-at-creation.md`

## Comments

## Answer
