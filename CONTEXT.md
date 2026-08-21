# KanjiScribe

A daily kanji study tool: words are ingested as study items, scheduled onto days as assignments, and drilled by the user.

## Language

**Assignment**:
A scheduled instance of a study item for a specific day (`assigned_for_date`).
_Avoid_: task, card, review

**Archived** (assignment status):
An assignment retained for history but excluded from all active queues, day counts, dashboard totals, and per-assignment reads — drill and word view both refuse it with 409. The "removed from the day" state — terminal from the user's point of view, but recoverable via the `unarchive` API endpoint.
_Avoid_: deleted, removed (use "Removed" only for the user-facing action verb)

**Removed** (action):
The user-facing action of taking an assignment out of its day's queue. Internally transitions the assignment to `archived`. Only applies to assignments that are `pending` or `skipped` — the day's unfinished work.
_Avoid_: Delete, discard (physical deletion is never performed on study data)

**Estimate snapshot**:
The estimate for a single assignment, computed once at assignment creation and persisted on the assignment (`estimated_ms`). It is the single source of "the estimate": forward views sum snapshots rather than recomputing, and post-completion performance is judged against the same number. Snapshots do not drift as attribution data accumulates, and no status transition (reopen, unarchive) recomputes them. Assignments created before snapshots existed carry `NULL` and show no performance data.
_Avoid_: live estimate, cached estimate

**Estimate delta**:
The performance of a `completed` assignment against its **estimate snapshot**: `time_spent_ms − estimated_ms`. Positive is **over estimate** (slower than estimated — up arrow, red); negative is **under estimate** (faster — down arrow, green). Only completed assignments with a non-NULL snapshot are judgeable; skipped assignments (even with `time_spent_ms`) and archived assignments never show a delta.
_Avoid_: variance, pace

**Day estimate delta**:
The day-level aggregate: Σ(time_spent_ms − estimated_ms) over a day's completed, snapshotted assignments. Displayed only when the day is strictly fully completed (`is_fully_completed`: no pending, no skipped, at least one completed) **and** every completed assignment has a snapshot — the verdict is final and complete, or not shown at all. Applies uniformly to every day-level surface (dashboard Today Time card, Today page, day detail header, heatmap cell outline and tooltip). Per-word deltas are final as soon as the word completes and are not gated.
_Avoid_: day pace, day score

**Day estimate**:
The planned drilling time for a single day: the sum of `estimated_ms` over the day's non-archived assignments (completed, pending, skipped). It is the target the **day estimate delta** is measured against — over a strictly fully completed, fully-snapshotted day, `day estimate delta = total_time_ms − day estimate`. Legacy assignments (NULL snapshot) contribute zero, so a day estimate is only trustworthy when snapshot coverage over the day is complete.
_Avoid_: budget (informal alias only — "budget" is rejected for the time-to-finish estimate), scheduled total, plan

**Time-to-finish estimate**:
The predicted drilling time remaining for a set of assignments: actual recorded `time_spent_ms` for completed items, plus the **estimate snapshot** of each pending/skipped item. A fully completed day contributes zero. The unit is milliseconds (displayed as a human duration).
_Avoid_: predicted time, budget (use "budget" only for a full-day total that ignores actuals)

**Writing cell model**:
The physical layout used when drilling a word by hand: 10 fixed cells. One kanji occupies one cell; up to two *adjacent* kana share one cell. One **clean copy** of the word is laid out left-to-right; the cell cost of a clean copy determines how many full copies fit (`floor(10 / cell_cost)`), and any leftover cells are **remainder-filled** with the word's highest-write-time characters — kanji one-per-cell (repetition allowed), kana two-per-cell.
_Avoid_: grid, slot (use "cell")

**Reading-writing** (drill convention):
On the **first clean copy** of an assignment, the word's reading is written out in kana alongside the surface form — for every surface character, including ones that are already kana (a kana is written twice in that first copy: once as surface, once as its own reading). Adds `len(selected_reading)` kana writes to the assignment; affects time only, not the cell layout. Subsequent clean copies are surface form only.
_Avoid_: furigana (that's a typography concept; this is handwriting), annotation

**Per-kanji write time**:
The derived time to write a single kanji once, observed indirectly from word-level `time_spent_ms` via **stroke-weighted attribution**: subtract the kana time (1 s per kana write, counting both surface kana writes and reading-writing kana writes) from the word's total, then split the remaining **kanji time pool** across the word's kanji in proportion to each kanji's (writes × stroke_count). Aggregated across all completed assignments containing that kanji.
_Avoid_: per-char time, stroke time

**Per-stroke coefficient**:
A single milliseconds-per-stroke number used to estimate an undrilled kanji's write time. Two sources: a constant **floor** (0.6 s/stroke, in code) used only when no completed assignment exists anywhere; and the **global per-stroke average** (total attributed kanji time ÷ total attributed strokes across all completions), which replaces the floor as soon as the first completion lands. Same shape — both are ms/stroke — so the floor is simply the prior before data. When the floor is in effect, a fixed per-card padding (10 s) is added to account for card-dwell overhead that no completion data has yet captured.
_Avoid_: stroke rate, stroke factor

**Kana unit**:
Any non-kanji character in a surface form or reading (hiragana, katakana, Latin, digits, punctuation). Treated uniformly for time: 1 s per write, pairable up to 2-per-cell, including in the reading-writing first-copy pass. There is no separate code path for Latin/digits — kana dominate by frequency, not by special-cased logic.

**Kanji attribution**:
A persisted row (in the `kanji_attribution` table) recording one kanji's share of a completed assignment's `time_spent_ms`: `(assignment_id, kanji_literal, stroke_count, writes_count, attributed_time_ms)`. Populated once by JS at completion time, after the **writing cell model** (including reading-writing) runs — the cell-packing and stroke-weighted split can't be expressed in SQL. Backfilled once over historical completions on first deploy. Deleted (in-app, within the reopen transaction) when the assignment transitions back to `pending`. Views roll up over it: per-kanji mean per-write time, per-stroke-count bucket mean, global per-stroke ratio.
_Avoid_: per-char record, timing log

**Completed** (assignment status):
An assignment that has been studied on its day. Carries `time_spent_ms` and `completed_at`. Can be `reopened` back to `pending`, but is never `archived` — removing a completed assignment would erase a study event, which is a different and unsupported operation.

### Releases

**Instance**:
A self-contained deployable copy of the app (`apps/`, `data/`, `docs/`, `systemd/`) occupying a directory on disk. The live instance sits at the release target; its siblings are release backups, the staging instance, or failed instances.
_Avoid_: deployment, build, app dir

**Release**:
The operation of promoting the dev build to a live instance: build, stage, stop service, copy data into staging, swap, start, verify — rolling back automatically if verification fails.
_Avoid_: deploy, ship, push

**Release backup**:
A timestamped sibling copy of the live instance at release time, created by renaming the live instance aside. Rollback restores from it. The three most recent are retained.
_Avoid_: snapshot, archive

**Staging instance**:
The complete fresh instance assembled before the swap, at a sibling path of the target. Never user-visible.
_Avoid_: candidate, temp

**Instance swap**:
The two atomic renames that make a release take effect: live → release backup, staging → live.
_Avoid_: cutover

**Failed instance**:
The instance that failed its health check and was swapped back out; kept at a `failed-<ts>` sibling for inspection. Only the most recent is retained.
_Avoid_: broken build

**Rollback**:
Restoring a release backup into the live slot. Always a full restore — code and data — so study data recorded since the release is discarded.
_Avoid_: revert, restore

## Assignment state machine

```
pending ──complete──→ completed
   │  ↑                 │
   │  └────reopen───────┘
   │
   └──skip──→ skipped
                 │
                 └──remove──→ archived
                 ↑
   pending ──remove──→ archived
```

- **archive** (Removal): valid only from `pending` or `skipped`.
- **unarchive** (Restore): valid only from `archived`, returns to `pending`. Reachable via API only.
- **complete / skip / reopen / drill / view**: reject `archived` assignments with `409 Conflict`. An archived assignment is not assignable, cannot transition to a study state, and cannot be inspected through the drill or word-view surfaces.

## Day's queue

The set of assignments for a given `assigned_for_date` that are not `archived`, presented in the user's arranged order. Ordering is user-defined for `pending` and `skipped` assignments via drag-and-drop; a `completed` assignment keeps the position it held when arranged (a status change never moves it), and assignments that were never arranged fall back to `created_at` order. No backfill exists — historical data keeps `created_at` ordering until a day is first reordered. A derived view, not a persisted collection — the order is stored per assignment (a nullable per-day position, `NULL` rows sorting after positioned rows), not in a queue table. "Queue" is UI/navigation language; the persisted concept is the per-day assignment set.

**Fully completed day**:
A day whose non-`archived` assignments contain no `pending`/`skipped` rows **and** at least one `completed` row. A day with zero assignments (all archived) is **not** fully completed — it is an empty day (see ghost-completed day ADR). Enforced by the `v_day_summary.is_fully_completed` view column.

**Backing list views**:
- **Today** — assignments scheduled for today.
- **Day detail** — assignments for a chosen day (day-in-the-past or today).
- **Backlog** — unfinished assignments across all days (`pending` or `skipped`).
- **Drill** — not a list; a single-card study session navigating the queue.

## Removal surfaces

The Remove action is available on **today**, **Day detail**, and **Backlog**. It is not available from the Drill page itself — removal is a list-view decision, distinct from the in-the-moment drill decision to skip/complete.

## Reordering surfaces

The user can reorder a day's `pending` and `skipped` assignments (drag-and-drop, via a per-assignment handle) on **today**, **Backlog** (within a day's group only — dragging never crosses days), and **Day detail**. Completed assignments are never draggable: they are fixed landmarks that hold their slot while the unfinished assignments rearrange around them. A **Day detail** page whose assignments are all `completed` is read-only — there is nothing unfinished to reorder. Reordering a day's queue changes the day's drill order, since the drill queue follows the arranged order.