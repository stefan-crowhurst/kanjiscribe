# Estimate performance delta

Status: ready-for-agent

## Problem Statement

As a KanjiScribe user, the app tells me how long my drilling will take (the time-to-finish estimate), but once I've finished I get no feedback on how I actually performed against those estimates. I can't tell whether I'm getting faster over time, whether the estimates are well-calibrated to my real handwriting speed, or whether a particular day went better or worse than predicted. The estimate is a one-way promise that is never checked — there is no feedback loop.

## Solution

Persist each assignment's estimate at the moment the assignment is created (the **estimate snapshot**), so that completion can be judged against the exact number that was on display while the work sat pending. Then surface the **estimate delta** (`time_spent_ms − estimated_ms`) with a simple up/down arrow coloured red/green plus the signed time delta:

- **Per word** — on the day detail page, each completed word card shows its delta next to its recorded time (up arrow red = over estimate/slower; down arrow green = under estimate/faster).
- **Per day** — once a day is strictly fully completed (no pending, no skipped, at least one completed) and every completed word has a snapshot, the **day estimate delta** (sum over completed words) appears: in the day detail header, on the dashboard's Today Time card (when the day is today), on the Today page, in the heatmap cell tooltip, and as a red/green outline on the heatmap cell itself.

Days that aren't final, or that mix legacy (pre-feature, snapshot-less) words with new ones, show no day-level verdict — per-word arrows still appear wherever a snapshot exists. Forward-looking estimate displays (Today card, Overdue card, backlog day rows, Today page) are unchanged in behaviour; they are now served from the stored snapshots instead of being recomputed live.

## User Stories

1. As a KanjiScribe user, I want each completed word on a past day's page to show an up or down arrow next to its recorded time, so that I can see at a glance whether that word was slower or faster than estimated.
2. As a KanjiScribe user, I want the arrow to be red when I was over the estimate and green when I was under it, so that the colour matches good/bad intuition.
3. As a KanjiScribe user, I want the arrow accompanied by the signed time delta (e.g. "+1:23", "−0:45"), so that I know *how much* I was over or under, not just the direction.
4. As a KanjiScribe user, I want the estimate a word is judged against to be the same estimate that was shown to me while the word sat in my queue, so that the comparison is honest — not a retroactively improved number I never saw.
5. As a KanjiScribe user, I want the estimate for each word to be captured when its assignment is created, so that the number is stable and doesn't drift as I drill other words.
6. As a KanjiScribe user, I want a word I drill to be judged against the knowledge the app had when the word was scheduled — even if I've since drilled related words — so that the delta reflects what the app actually believed at the time.
7. As a KanjiScribe user, I want a fully completed past day to show an overall day delta in the day page header, so that I can see whether the day as a whole beat or missed the estimate.
8. As a KanjiScribe user, I want the dashboard's Today Time card to show today's day delta once today is fully completed, so that I get my verdict for the day on the main screen.
9. As a KanjiScribe user, I want the Today page to show the day delta once everything today is finished, so that completing my queue ends with a performance summary.
10. As a KanjiScribe user, I want heatmap cells for fully completed days to carry a red or green outline (slower/faster), so that my performance trend is visible across the whole year without clicking into days.
11. As a KanjiScribe user, I want the heatmap tooltip for a fully completed day to show its day delta alongside the existing drill counts, so that hovering gives me the full story.
12. As a KanjiScribe user, I want no day-level verdict shown while a day still has pending or skipped work, so that I'm never shown a "final" result that could still change.
13. As a KanjiScribe user, I want days that mix pre-feature words (no stored estimate) with new words to show no day-level verdict, so that I'm never shown a partial sum presented as the whole day's performance.
14. As a KanjiScribe user, I want words with no stored estimate (created before this feature) to simply show no arrow, so that the UI never fabricates a comparison it can't honestly make.
15. As a KanjiScribe user, I want skipped words to never show a delta — even when I spent some time looking at them — so that partial "looked at it" time is never compared against a full-drill estimate.
16. As a KanjiScribe user, when I reopen a completed word and drill it again, I want the second attempt judged against the original estimate, so that the comparison stays anchored to what I was originally shown.
17. As a KanjiScribe user, I want archived (removed) assignments to never appear in any delta, so that performance reporting matches every other count in the app.
18. As a KanjiScribe user, I want a word completed in exactly its estimated time to show a neutral indicator rather than a red or green arrow, so that on-target performance doesn't read as pass/fail noise.
19. As a KanjiScribe user, I want the forward-looking time-to-finish estimates (Today card, Overdue card, backlog days, Today page) to keep behaving exactly as they do now, so that planning my session is unaffected by the change.
20. As a KanjiScribe user, I want the day delta to equal the sum of the per-word deltas I see on the day page, so that the two views always agree.
21. As a KanjiScribe user, I want the delta to load together with the day/assignment data it annotates (no separate spinner), so that performance reporting feels built-in rather than bolted on.

## Implementation Decisions

### Domain model (already captured in `CONTEXT.md`)

The grilling session produced three new glossary terms, which are authoritative: **estimate snapshot** (computed once at assignment creation, persisted, single source for forward views and judging; never recomputed by any status transition; `NULL` for legacy rows), **estimate delta** (per-word, completed-with-snapshot only), and **day estimate delta** (strictly gated day aggregate). **Time-to-finish estimate** was revised to sum snapshots. No ADR was written — the user decided the glossary suffices.

### Schema changes

One new migration (`0005`): add a nullable integer column `estimated_ms` to `daily_assignment`. Milliseconds, rounded to integer at write time (the estimate math produces fractional ms via averages and the per-stroke slope). `NULL` means "no snapshot" — all rows existing before this migration.

**No backfill of any kind** (decided during grilling): historical completed rows keep `NULL` (no past-day performance reporting), and currently-pending/skipped legacy rows also keep `NULL`. The accepted consequence: forward estimates (`/estimates/*`) silently treat legacy pending rows as 0 ms until they drain — the user accepted this undercount explicitly rather than run a hybrid read or a fill migration.

### Write path: snapshot at intake

The only assignment-creation path is `POST /study-items/intake`. After the `INSERT INTO daily_assignment`, and **in the same transaction**, compute the estimate with the existing `estimateAssignment` function and `UPDATE` the row's `estimated_ms`. For a freshly inserted pending row that function returns exactly the right value: the Level-0 `avg_completion_time_ms` for previously-drilled items, or the 4-level fallback chain for never-drilled items.

The intake endpoint's unarchive-reactivate path (re-adding a previously removed word) does **not** write a snapshot: the row keeps whatever `estimated_ms` it already has (`NULL` for pre-feature rows). No status transition ever recomputes the snapshot — reopen, skip, complete, archive, and unarchive all leave it untouched.

`estimateAssignment` is otherwise unchanged. It is no longer called by any estimate endpoint (see below); its completed/archived branches simply stop being exercised — leave the function intact (minimal intrusion).

### Read path: estimates become SQL sums

The three estimate endpoints stop looping per-assignment through `estimateAssignment` and become single aggregate queries over `daily_assignment`:

- `GET /estimates/today` — `SUM(time_spent_ms)` over today's completed rows + `SUM(estimated_ms)` over today's pending/skipped rows. Archived excluded as today. `NULL` snapshots contribute 0 (accepted undercount).
- `GET /estimates/backlog-days` — `SUM(estimated_ms)` over strictly-past pending/skipped rows (unchanged date semantics).
- `GET /estimates/backlog-day?date=…` — `SUM(estimated_ms)` over that date's pending/skipped rows.

Response shapes (`{ estimated_remaining_ms: number }`) and all display formatting (`formatMsEstimate`) are unchanged.

### Delta data contracts

- `GET /assignments` (and any other assignment-list payload used by the day page) gains a nullable `estimated_ms` per row. The per-word chip is rendered client-side from `time_spent_ms − estimated_ms` when the row is `completed` and `estimated_ms` is non-null; otherwise no chip.
- `GET /stats/dashboard` heatmap rows gain a nullable `estimate_delta_ms`. The day gate is computed **server-side**: the value is present only when the day `is_fully_completed` **and** every completed assignment of the day has a non-null snapshot (full coverage); it equals `SUM(time_spent_ms − estimated_ms)` over the day's completed snapshotted rows. `NULL` when the gate fails (legacy days, mixed-coverage days, days with pending/skipped remaining, empty days). This keeps all gate logic at the tested HTTP seam; the frontend is a thin renderer.

### Surfaces

- **Day detail page** — per-word chip on each completed assignment card (next to the existing "Time: X"); day delta in the header when today's date row carries a non-null `estimate_delta_ms` (the page already fetches the single-day dashboard range).
- **Dashboard Today Time card** — shows today's day delta when today's heatmap row carries a non-null `estimate_delta_ms` (strictly gated; no mid-flight display). No separate fetch — the dashboard payload already includes the heatmap rows.
- **Today page** — shows the day delta once today is fully completed; obtains it from the same per-date dashboard data (single-day range fetch, same pattern as the day detail page).
- **Heatmap** — cells for gated days get a red/green outline (CSS outline/border class alongside the existing `tone-*` fill classes); zero-delta days get no outline. The tooltip's detail line gains the signed delta for gated days.
- **Backlog page, Overdue card, Today card estimate lines** — forward-estimate surfaces; unchanged behaviour, now served from snapshots.

### Display format

One shared delta indicator (small component or helper): up arrow + red when positive, down arrow + green when negative, followed by the signed duration — `formatMs(abs(delta))` with an explicit `+`/`−` sign. Exact zero renders as a muted neutral "±0:00" with no arrow (and no heatmap outline). Arrow glyphs are simple ↑/↓ characters styled by CSS classes, matching the app's plain-CSS approach.

## Testing Decisions

### One seam: HTTP integration via `app.inject` (existing seam)

Confirmed with the user. All decision-rich behaviour is server-side and observable through the existing Fastify `app.inject` integration seam with direct DB seeding via `test-helpers.ts`. Prior art: `estimates-today.test.ts`, `estimates-backlog.test.ts`, `attribution.test.ts`, `archive.test.ts`. No new seams; no frontend test seam (the web layer is a thin renderer — subtract two numbers, pick a class).

Unlike the estimate feature (which added a pure-function seam for the edge-case-dense cell model), this feature introduces no dense pure logic: the estimate computation already exists and is already tested at this seam.

### What makes a good test for this feature

External behaviour only: seed the DB (through the intake endpoint where snapshot-writing matters, or directly with an explicit `estimated_ms` where only reading matters), hit endpoints, assert on response bodies. Don't assert on internal function calls, SQL shapes, or component structure.

### Modules tested

- Intake endpoint (snapshot written at creation; unarchive-reactivate preserves).
- The three estimate endpoints (SUM semantics).
- `/assignments` (`estimated_ms` exposure).
- `/stats/dashboard` (gate + day delta).
- Reopen endpoint (snapshot preserved across reopen/recomplete).

### Existing test rework required

`estimates-today.test.ts` and `estimates-backlog.test.ts` currently seed assignments via direct `INSERT` (which produces `NULL estimated_ms`) and assert live-computed values. Under SUM semantics those tests must be reworked: seed through the intake endpoint (snapshots written), or extend the seed helper to accept an explicit `estimated_ms`. The helper's `INSERT` gains the nullable column; `resetDb()` needs no change (column lives on an existing wiped table).

### Critical test scenarios (representative, not exhaustive)

- Intake of a previously-drilled word stores `estimated_ms` equal to the item's current `avg_completion_time_ms`.
- Intake of a never-drilled word stores `estimated_ms` equal to the fallback-chain estimate (same value the old endpoint would have returned).
- A pending assignment's snapshot does not change when other words are completed afterwards (no drift).
- Reopen then recomplete: `estimated_ms` is unchanged; the delta observable via `/assignments` uses the original snapshot.
- Unarchive-reactivate via intake: pre-existing snapshot preserved.
- `/estimates/today` = actuals of completed + snapshots of pending/skipped; archived excluded; `NULL`-snapshot pending rows contribute 0.
- `/estimates/backlog-days` and `/estimates/backlog-day` sum snapshots of pending/skipped only.
- Dashboard day delta: fully completed day with all snapshots → correct signed sum (over and under cases).
- Gate failures all yield `null`: pending remaining; skipped present; mixed legacy/snapshot coverage; all-legacy day; empty day.
- `/assignments` rows include `estimated_ms` (null for legacy, value for new).

## Out of Scope

- **Any backfill of `estimated_ms`** — replay backfill, cheap backfill, and fill-pending-at-deploy were all considered and explicitly rejected during grilling. Legacy rows stay `NULL` forever; the forward-estimate undercount during the transition is accepted.
- **Recomputing snapshots on any transition** — reopen, unarchive, or any future transition never rewrites `estimated_ms`.
- **Mid-flight day verdicts** — no surface shows a day delta before strict full completion (including the Today Time card; a delta-so-far/pace concept was considered and rejected).
- **Looser day gates** — "no pending remain" (tolerating skipped) and "partial sums with coverage notes" were considered and rejected in favour of strict `is_fully_completed` + full snapshot coverage.
- **Performance display on other surfaces** — Backlog page, Backlog/Overdue cards, drill page, and word view page show no deltas. The backlog is forward-looking only.
- **Heatmap fill-tone changes** — the `tone-*` fill encoding is untouched; performance is conveyed by the outline layer only.
- **Aggregate performance analytics** — per-word average delta over time, calibration trends, or charts of estimate accuracy are not part of this feature.
- **Changes to the estimate algorithm itself** — the 4-level fallback chain, cell model, and attribution are untouched (ADRs 0003–0005 remain authoritative there).
- **A frontend test seam** — none exists in the repo and none is added.

## Further Notes

### Provenance

All decisions in this PRD come from a `/grill-with-docs` session and are recorded in `CONTEXT.md` (estimate snapshot, estimate delta, day estimate delta; revised time-to-finish estimate). Where this PRD and `CONTEXT.md` disagree, `CONTEXT.md` is authoritative for language and this PRD for implementation detail. ADRs 0003–0005 govern the underlying estimate computation, which this feature consumes but does not modify.

### Transition-period behaviour to be aware of

Until pre-feature pending rows drain (complete, or are removed), forward estimates understate the true remaining time (legacy rows contribute 0), and days containing legacy completions show no day-level verdict. Both effects are self-healing and were explicitly accepted by the user.

### Implementation order suggestion

The natural tracer-bullet slices: (1) migration + intake snapshot + `/assignments` exposure + estimate endpoints switched to SUM (with the existing-test rework); (2) dashboard gated day delta; (3) web surfaces (day page chips + header, Today Time card, Today page); (4) heatmap outline + tooltip.
