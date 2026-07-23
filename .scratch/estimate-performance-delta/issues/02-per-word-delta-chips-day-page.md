# Per-word delta chips on the day detail page

Status: ready-for-agent

## Parent

`.scratch/estimate-performance-delta/PRD.md`

## What to build

The per-word **estimate delta** display (see `CONTEXT.md`: estimate delta). A shared delta indicator rendered on each completed word card of the day detail page, so a past day's per-word performance is visible at a glance.

End-to-end behaviour:

- On the day detail page, each completed assignment card shows a delta chip next to its existing "Time: X" — computed client-side as `time_spent_ms − estimated_ms` from the `/assignments` payload.
- Positive delta (slower than estimated): up arrow ↑, red, signed duration (e.g. "+1:23"). Negative delta (faster): down arrow ↓, green, signed duration (e.g. "−0:45"). Duration is the existing `formatMs` applied to the absolute value, with an explicit sign.
- Exact zero: muted neutral "±0:00", no arrow, no colour.
- No chip when the row is not `completed`, or when `estimated_ms` is null (legacy pre-feature words) — the UI never fabricates a comparison it can't make.
- Skipped assignments never show a chip, even when they carry `time_spent_ms`.
- The indicator is one small shared component/helper (arrow glyph ↑/↓ + CSS colour classes, matching the app's plain-CSS approach) so later slices (day header, Today Time card, Today page, heatmap tooltip) reuse the same rendering.

## Acceptance criteria

- [ ] Completed word cards on the day detail page show the chip only when `estimated_ms` is non-null.
- [ ] Over estimate → ↑ red with "+M:SS"; under estimate → ↓ green with "−M:SS"; exact zero → muted "±0:00" with no arrow.
- [ ] Skipped rows (with or without `time_spent_ms`) and pending rows never show a chip.
- [ ] Legacy completed rows (null snapshot) render exactly as before this feature.
- [ ] The day page layout is otherwise unchanged; the chip rides the existing `/assignments` payload (no extra fetch, no extra loading state).
- [ ] The indicator component is shared/reusable by the day-level surfaces in slices 3 and 4.

## Blocked by

- `.scratch/estimate-performance-delta/issues/01-estimate-snapshots-at-creation.md`

## Comments

## Answer
