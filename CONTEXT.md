# KanjiScribe

A daily kanji study tool: words are ingested as study items, scheduled onto days as assignments, and drilled by the user.

## Language

**Assignment**:
A scheduled instance of a study item for a specific day (`assigned_for_date`).
_Avoid_: task, card, review

**Archived** (assignment status):
An assignment retained for history but excluded from all active queues, day counts, and dashboard totals. The "removed from the day" state — terminal from the user's point of view, but recoverable via the `unarchive` API endpoint.
_Avoid_: deleted, removed (use "Removed" only for the user-facing action verb)

**Removed** (action):
The user-facing action of taking an assignment out of its day's queue. Internally transitions the assignment to `archived`. Only applies to assignments that are `pending` or `skipped` — the day's unfinished work.
_Avoid_: Delete, discard (physical deletion is never performed on study data)

**Completed** (assignment status):
An assignment that has been studied on its day. Carries `time_spent_ms` and `completed_at`. Can be `reopened` back to `pending`, but is never `archived` — removing a completed assignment would erase a study event, which is a different and unsupported operation.

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
- **complete / skip / reopen / drill**: reject `archived` assignments with `409 Conflict`. An archived assignment is not assignable and cannot transition to a study state.

## Day's queue

The set of assignments for a given `assigned_for_date` that are not `archived`, ordered by `created_at`. A derived view, not a persisted collection — there is no `queue` table. "Queue" is UI/navigation language; the persisted concept is the per-day assignment set.

**Fully completed day**:
A day whose non-`archived` assignments contain no `pending`/`skipped` rows **and** at least one `completed` row. A day with zero assignments (all archived) is **not** fully completed — it is an empty day (see ghost-completed day ADR). Enforced by the `v_day_summary.is_fully_completed` view column.

**Backing list views**:
- **Today** — assignments scheduled for today.
- **Day detail** — assignments for a chosen day (day-in-the-past or today).
- **Backlog** — unfinished assignments across all days (`pending` or `skipped`).
- **Drill** — not a list; a single-card study session navigating the queue.

## Removal surfaces

The Remove action is available on **today**, **Day detail**, and **Backlog**. It is not available from the Drill page itself — removal is a list-view decision, distinct from the in-the-moment drill decision to skip/complete.