# Archived assignments are reversible via API but not surfaced in the UI

## Context

Adding the ability to remove an incomplete (`pending` or `skipped`) assignment from a day's queue, by transitioning it to the `archived` status. The codebase's standing principle (PLAN.md) forbids hard-deleting study data, so removal is a soft archive.

## Decision

Removal transitions an assignment to `archived` and is reversible in principle: a `POST /assignments/:id/unarchive` endpoint returns the assignment to `pending` (mirroring the existing `reopen` action's shape and behaviour). However, **no frontend Restore affordance is built in this iteration**. Restoration is reachable via API only.

The `archived` status is terminal from the user's point of view unless explicitly restored through the API; no "Archived" list view or per-row "Restore" button ships as part of the remove-from-queue feature.

## Considered Options

- **A. Terminal archive** — no `unarchive` path at all. Rejected: a misclick (even post-confirm) would cost the user the card for that day with no recovery except DB surgery. Single-user self-hosted app keeps the cost low, but locking the door when the data already exists is needlessly brittle.
- **B. Reversible with a full Restore UI** — adds an `unarchive` endpoint plus an "Archived" list view with restore buttons. Rejected: the list view is its own feature with its own design questions (grouping, restore-target date) that would expand scope well beyond "drop cards from a day".
- **C. Reversible via API, no UI (chosen)** — the endpoint ships so the operation is genuinely non-destructive, but the frontend scope stays narrow. A future "Archived" view can attach to the existing endpoint with no schema or API work.

## Consequences

- A future reader will see an `unarchive` endpoint with no caller in the web app and wonder why it exists. That is intentional: it preserves reversibility without committing to an "Archived" UI surface before there's a demonstrated need.
- If an "Archived" / trash view is later built, it requires only frontend work — the API surface is complete today.
- Misclick recovery for end users (not at a terminal) requires hitting the API directly. Acceptable for a self-hosted single-user tool; revisit if/when multi-user or less-technical users are served.