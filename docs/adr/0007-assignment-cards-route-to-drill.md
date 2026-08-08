# Assignment cards route to the drill session unless completed: skipped assignments open the drill, not the word view

## Context

The assignment list (`apps/web/src/components/AssignmentList.tsx`) routes a card click to one of two surfaces: the **drill** session (`/drill/:id`, where the assignment's work is done) or the **word view** (`/word/:id`, a read-only reference page).

Before the api-modularization refactor the routing was:

```ts
const cardUrl = isPending ? drillPath : viewPath;
```

`pending` cards opened the drill; everything else — including `skipped` — opened the word view. During the refactor (commit `67e72c3`) this was inverted:

```ts
const cardUrl = isCompleted ? viewPath : drillPath;
```

`completed` cards open the word view; everything else — including `skipped` — opens the drill. The two-axis review (2026-08-07) flagged this as a behavior change smuggled into a refactor. It is intentional, and this ADR records it as a decision rather than a refactor artifact.

## Decision

Card navigation is **completed → word view; pending and skipped → drill session** — i.e. the drill is the default card destination, and only completed assignments open the read-only word view.

Rationale: a `skipped` assignment is the day's unfinished work (CONTEXT.md: the Remove action applies to `pending`/`skipped` — "the day's unfinished work"). Continuing that work means drilling it; opening a read-only reference page for an unfinished assignment is the wrong affordance. The word view is a reference surface for study that has already happened (`completed`), not a place to resume work. The drill surface is also where queue navigation (today/backlog) is coherent, which is exactly the context a skipped assignment needs.

## Considered Options

- **A. Status inversion — drill unless completed (chosen).** One check (`isCompleted ? viewPath : drillPath`); the drill is the default destination and the word view is the explicit completed-only exception.
- **B. Preserve the old routing — drill only when pending.** Skipped cards opened the read-only word view of an unfinished assignment, which offers no way to resume the work except clicking away. Rejected: wrong affordance for unfinished work.
- **C. Explicit three-way switch (`pending`/`skipped` → drill, `completed` → view).** Equivalent behavior to A for the three statuses AssignmentList renders; more branches for no semantic gain. Rejected as unnecessary.
- **D. No default — force per-status navigation at every call site.** Duplicated decision logic across every list surface. Rejected.

## Consequences

- A skipped assignment's card starts (or continues, via queue navigation) a drill session; `completed` cards are the only word-view entry point from the list.
- The word view remains directly reachable by URL for any assignment; the routing change affects list navigation only.
- Statuses other than the three listed do not appear in list views (`archived` is excluded from every list query), so the two-branch check is exhaustive in practice; if a future status appears, it inherits the drill default.
