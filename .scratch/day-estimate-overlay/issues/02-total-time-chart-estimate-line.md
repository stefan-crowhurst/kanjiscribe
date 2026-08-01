# Total Time chart: dashed day-estimate line + enriched tooltip

Status: ready-for-agent

## Parent

`.scratch/day-estimate-overlay/PRD.md`

## What to build

The dashboard **Total Time** chart (Per-day Stats) visually overlays the **day estimate** (see `CONTEXT.md`) on each day's elapsed time, using the `estimated_total_ms` field added by slice 01.

End-to-end behaviour:

- The `ComposedChart` gains a dashed neutral-grey `Line` for the estimate, sitting alongside the existing actual-time bar and solid red line. `connectNulls={false}` so days with `estimated_total_ms: null` (unfinished or legacy days) leave a gap in the dashed line rather than a connecting segment.
- The y-axis max is computed from both actual and estimate values, so the estimate line is never clipped.
- The hover tooltip shows **Total time**, and on days carrying an estimate also **Day estimate** plus an over/under delta line (`total_time − day_estimate`, same sign/magnitude semantics as the estimate delta indicator). Days without an estimate render the tooltip as before.
- No legend is added. Words Completed and Avg Time per Word charts are unchanged.

## Acceptance criteria

- [ ] Total Time chart renders the dashed estimate line; gated-out days show a gap, not a line segment.
- [ ] The dashed line stays within the y-axis (estimate values included in the axis max); nothing is clipped.
- [ ] Tooltip on estimate days shows Total time, Day estimate, and the over/under delta; on non-estimate days it is unchanged.
- [ ] Existing bar + solid red actual line render exactly as before; no legend added.
- [ ] `npm run typecheck` and `npm run lint` pass in `apps/web`.

## Blocked by

- `.scratch/day-estimate-overlay/issues/01-estimated-total-heatmap.md`

## Answer

Implemented. `apps/web/src/components/ProgressCharts.tsx`: added `estimated_total_ms` to `ChartDay` and `estimateMin`/`estimateMs` to `TimeChartData`; dashed `#766958` estimate `Line` (`strokeDasharray="5 5"`, `connectNulls={false}`) after the bar + solid red line; `maxTimeMin` now includes estimate values; `TimeTooltipContent` shows Day estimate + over/under delta when present. Typecheck and lint pass.
