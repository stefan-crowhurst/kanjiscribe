# Previously-drilled word estimate on Today card

Status: ready-for-agent

## Parent

`.scratch/time-to-finish-estimate/PRD.md`

## What to build

End-to-end vertical slice for the **Level-0** estimate path: estimating today's remaining drilling time using actual recorded completion averages for previously-drilled study items, and displaying the result on the Today card of the dashboard.

This slice establishes the estimate endpoint, the display util, and the non-blocking frontend pattern — everything except the never-drilled-word fallback chain, which arrives in a later issue. Never-drilled words on today contribute 0 ms for now.

### API

New endpoint `GET /estimates/today` returning `{ estimated_remaining_ms: number }`. The endpoint:

1. Finds today's `daily_assignment` rows where `status IN ('pending', 'skipped')` and `status != 'archived'` (today's remaining items).
2. For each remaining assignment, looks up the study item's `times_completed` from `v_study_item_stats`. If `times_completed >= 1`, the assignment's estimate is `avg_completion_time_ms` from `v_study_item_stats`.
3. If `times_completed = 0` (never drilled), the assignment contributes 0 ms for now — the per-kanji fallback chain is a later slice.
4. Today's `completed` assignments contribute their actual `time_spent_ms` to the sum, so the estimate drops as the user completes items.
5. The endpoint returns the sum across remaining-estimates plus completed-actuals.

Returns raw milliseconds. No HTTP cache headers (recompute on every request, matching every other stats endpoint). Tests follow the existing `app.inject` seam pattern.

### Frontend

New pure util `formatMsEstimate(ms: number): string` placed next to the existing `formatMs`. Same `M:SS` shape but uses `Math.ceil` on the seconds component (vs `formatMs`'s `Math.floor`). The existing `formatMs` is unchanged — actual recorded times on the DrillPage footer and Dashboard "Today Time" card continue to floor.

Today card on the dashboard renders fully before the estimate request resolves. The estimate fetch runs in a new `useEffect` alongside the existing stats fetch, with its own state slot. The estimate cell shows a placeholder (e.g. "—" or "loading…") until the request resolves, then re-renders with `formatMsEstimate`.

### Out of scope for this slice

- Never-drilled words per-kanji fallback chain — `GET /estimates/today` returns 0 ms for those words in this slice.
- Any display surface other than the Today card on the dashboard.
- The cell model (this slice reads existing `v_study_item_stats` only).

## Acceptance criteria

- [ ] `GET /estimates/today` returns `{ estimated_remaining_ms: number }` where the number is the sum of (Level-0 estimates for each pending/skipped assignment with `times_completed >= 1`) plus (actual `time_spent_ms` of completed assignments on today).
- [ ] A today whose pending words have all been previously drilled returns an estimate equal to the sum of their `avg_completion_time_ms` values.
- [ ] A today whose pending words have `times_completed = 0` returns 0 for those words specifically (other previously-drilled words still contribute).
- [ ] Completed assignments on today contribute their actual `time_spent_ms` to the sum — so as the user drills and completes items, the estimate drops.
- [ ] Archived assignments on today contribute nothing to the sum (match the existing dashboard exclusion semantics).
- [ ] `formatMsEstimate` produces `M:SS` with the seconds component ceiled (e.g. 6500 ms → "0:07", 60000 ms → "1:00", 60500 ms → "1:01").
- [ ] Dashboard Today card renders its existing content immediately; the estimate appears in a dedicated slot and replaces a placeholder once the `/estimates/today` request resolves.
- [ ] No HTTP `ETag`/`Cache-Control` headers are set on the endpoint.
- [ ] Tests at the existing `app.inject` HTTP seam cover Level-0 estimates, completed-item actuals dropping the sum, archived-item exclusion, and the all-undrilled-pending-word edge case.

## Blocked by

None - can start immediately.

## Comments

## Answer