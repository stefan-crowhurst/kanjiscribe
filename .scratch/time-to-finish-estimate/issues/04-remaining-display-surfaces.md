# Remaining display surfaces: Backlog card, Backlog page, Today page

Status: ready-for-agent

## Parent

`.scratch/time-to-finish-estimate/PRD.md`

## What to build

Extends the estimate display to the remaining three surfaces named in the PRD: the Backlog card on the dashboard (sum across past overdue days), each per-day row on the Backlog page, and the Today page.

### API

Two new endpoints:

- `GET /estimates/backlog-days` returns `{ estimated_remaining_ms: number }` — the sum across all strictly past overdue assignments (matching the existing `overdue` block semantics: `status IN ('pending','skipped') AND assigned_for_date < today`). Calls the same per-assignment estimate helper produced in issue 03 (Level-0 for previously-drilled words, Level-1/2/3/4 fallback for never-drilled).
- `GET /estimates/backlog-day?date=YYYY-MM-DD` returns `{ estimated_remaining_ms: number }` — the sum over that single day's remaining (pending/skipped) assignments. Used by the Backlog page for the per-day estimate.

Both return raw milliseconds. No HTTP cache headers (matches every existing stats endpoint).

### Frontend: Backlog card

Dashboard's Backlog card currently shows `data.overdue.total_pending` open and `oldest_date`. Adds an estimate slot that loads non-blocking: a new `useEffect` fires `GET /estimates/backlog-days` on mount, the card renders with a placeholder, the estimate fills in when the request resolves. `formatMsEstimate` (from issue 01) is reused for the display.

### Frontend: Backlog page per-day

Backlog page currently fires `GET /assignments/backlog` on mount and groups assignments by `assigned_for_date`. After the initial render resolves, the page fires a request per day (`GET /estimates/backlog-day?date=...`) — implementations may batch via `Promise.all` over the visible days. Each day row renders fully before its estimate request resolves; the estimate slot shows a placeholder initially and replaces it as each day's request completes.

### Frontend: Today page

Today page currently fires `GET /stats/dashboard?from=today&to=today` and `GET /assignments?date=today` in parallel on mount. Adds an estimate slot using `GET /estimates/today` (produced by issue 03). The estimate loads non-blocking alongside the existing fetches; the page renders the existing assignment list and the day's stats immediately, and the estimate slot fills in when the request resolves.

### Rounding composition

Per the grilling session's rounding rules:

- Backlog card: the API sums raw milliseconds across all past overdue days and returns the grand total; the frontend applies `formatMsEstimate` (ceil) to the grand total exactly once. No per-day rounding accumulates.
- Backlog page per-day row: the API returns that day's raw total; the frontend applies `formatMsEstimate` (ceil) to it.
- Today page: same — API returns raw ms, frontend applies `formatMsEstimate`.

The API never rounds; rounding is a display-layer concern only, applied via the shared `formatMsEstimate` util from issue 01.

## Acceptance criteria

- [ ] `GET /estimates/backlog-days` returns the sum of estimate values across strictly past overdue assignments (today's leftover is excluded, matching the existing `overdue` definition).
- [ ] `GET /estimates/backlog-day?date=YYYY-MM-DD` returns the sum of estimate values across that day's pending/skipped assignments.
- [ ] Both endpoints include Level-0 previously-drilled assignments (their `avg_completion_time_ms`) and Level-1/2/3/4 fallback estimates for never-drilled assignments in their sums (per the helper from issue 03).
- [ ] Both endpoints return raw milliseconds (no rounding at the API).
- [ ] Dashboard Backlog card renders its existing content immediately; the estimate appears in a dedicated slot and replaces a placeholder once `/estimates/backlog-days` resolves.
- [ ] Backlog page renders its day list from `/assignments/backlog` first; each day row's estimate slot fills in as its per-day estimate request resolves (`formatMsEstimate` is applied per-day row, not to a sum).
- [ ] Today page renders its assignment list and stats immediately; the estimate appears in a dedicated slot and replaces a placeholder once `/estimates/today` resolves.
- [ ] Backlog card estimate does not include today's leftover items (only strictly past overdue).
- [ ] Backlog page per-day estimate is only that single day's remaining items.
- [ ] All four display surfaces use `formatMsEstimate` (ceil); actual recorded times elsewhere (DrillPage footer, Dashboard "Today Time" card) continue to use `formatMs` (floor).
- [ ] No HTTP `ETag`/`Cache-Control` headers set on the new endpoints.
- [ ] Tests at the existing `app.inject` seam cover: backlog-days matches the `overdue` definition (strict past only); backlog-day returns the single day's value; multi-day sum aggregates correctly; each Level-0, Level-1/2/3, and floor path feeds the day-summed endpoints.

## Blocked by

- `.scratch/time-to-finish-estimate/issues/03-never-drilled-word-estimate.md` — needs the per-assignment estimate helper and the `/estimates/today` endpoint to extend from.
- `.scratch/time-to-finish-estimate/issues/01-previously-drilled-estimate-today-card.md` — needs `formatMsEstimate`.

## Comments

## Answer