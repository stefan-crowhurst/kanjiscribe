# Per-day queue ordering via a nullable position column

## Context

Assignments within a day were ordered by `created_at` everywhere (list views and the drill queue alike). The user wants to reorder a day's unfinished assignments by drag-and-drop on Today, Backlog, and Day detail, and expects the arranged order to be the drill order. Order had to become user-defined rather than derived.

## Decision

Add a nullable `queue_position` column to `daily_assignment`, scoped per `assigned_for_date`. A day's queue orders by `queue_position ASC` with `NULL`s last, then `created_at ASC`. Only `pending` and `skipped` assignments are draggable; completed assignments are fixed anchors that hold their slot while unfinished cards rearrange around them, and status transitions never write a position (except `unarchive`, which clears it so a restored card lands at the end).

The reorder endpoint (`PUT /assignments/:date/order`) takes the ordered subset of `pending`/`skipped` ids. The server merges that subset into the day's current resolved order — completed cards keep their exact positions — and renumbers `1..n` inside a transaction. The client updates optimistically and rolls back on failure.

No backfill is performed: historical data and any never-arranged day keep `created_at` ordering until a day is actively reordered.

## Considered Options

- **A. Full-list payload (rejected).** Client sends every non-archived id in final order. Faithful drop semantics, but the Backlog page never loads completed rows for a day, so it would need an extra per-day fetch and would send positions it doesn't render.
- **B. Subset payload, anchored merge (chosen).** One endpoint shape, no new fetches, and completed cards as permanent anchors — consistent with "completed assignments retain their position."
- **C. Fractional/lexorank keys (rejected).** Insert-between-neighbors without renumbering, but drift and complexity at a scale (single user, small days) where an O(n) renumber in a transaction is trivial.
- **D. Backfill existing rows (rejected).** Writing positions for all historical data buys nothing: created_at ordering is still correct for never-arranged rows and costs a one-time migration that can never be undone cleanly.

## Consequences

- A reordered day loses its original `created_at` ordering permanently from the UI's perspective (the column is untouched, but no surface sorts by it for that day). The position can only be cleared by editing the DB directly.
- The drill queue and the Today page's first-unfinished "Drill" link follow the arranged order.
- Newly created assignments (manual, anki, carryover, requeue) land at the end of the queue for free: they carry `NULL` position.
- The drag handle is the only reorder affordance; whole-card dragging was rejected to keep card click-navigation and the Remove button unambiguous.
