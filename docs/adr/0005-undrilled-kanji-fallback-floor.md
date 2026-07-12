# Undrilled-kanji fallback uses a 0.5 s/stroke code constant, not a config value

## Context

When a never-drilled kanji has no attributed timing data and no same-stroke-count siblings, its write time is estimated by multiplying its stroke count by a **per-stroke coefficient**. Before any assignment has ever been completed, the global per-stroke average (which would supply that coefficient) is undefined. The estimate must display *something* on a fresh install, so a constant floor is needed.

The floor is replaced — not added to, not blended — the moment the first completion lands and the global per-stroke average has a real value. The floor is therefore purely the prior before data.

## Decision

Set the floor at **0.5 s/stroke (500 ms/stroke)**, stored as a **coded constant** in the TypeScript estimate module — not in `app_config`, not in a `.env`, not in a settings row.

Research basis: Tamaoka, Phương, Zhang, Kawahara & Verdonschot (2026), *Frontiers in Language Sciences* — single-kanji handwriting durations among Vietnamese JFL learners aged 20-30, JLPT N1-N3, on a stylus-on-tablet task. Regression of writing duration on stroke count: intercept 3,826 ms at 8.58 mean strokes, with a visual-complexity coefficient of 1,481 ms per SD (3.89 strokes), giving a marginal of **~380 ms per stroke** for pure motor execution. The study deliberately excluded overhead that a real drilling session captures (card dwell time, reading glosses, looking at stroke-order diagrams), so 0.5 s/stroke is a deliberate ~30% upward adjustment. This satisfies the project's "**round up when in doubt**" preference — the estimate should err high, not low.

## Considered Options

- **A. 0.5 s/stroke, code constant (chosen).** Research-justified round-number prior. Tunnable only via a code change, which is correct: this is a modelling assumption, not a user preference, and changes to it are modelling revisions that should go through review.
- **B. 1 s/stroke, deliberately heavier.** Rejected: would make fresh-install estimates look alarming (`漢` estimated at 14 s per write alone, near a hundred seconds for a single undrilled word). The 380 ms/stroke research floor makes 1 s/stroke hard to justify, even with the round-up preference.
- **C. Config-stored coefficient in `app_config`.** Rejected: hides a modelling decision behind a settings surface. The `app_config` table is for things a user actually configures (per-machine paths, ports); a research-derived prior doesn't belong there, and a hidden row invites drift when someone tunes it without understanding the research basis.
- **D. 380 ms/stroke, matching the research exactly.** Rejected: the study measures only the motor-execution phase; the app's `time_spent_ms` captures the full card dwell, so matching the study's number would systematically under-estimate on fresh installs. 0.5 s/stroke honors "round up when in doubt."

## Consequences

- Fresh-install numbers (e.g. `漢` estimated at 7 s per write) sit above plausible reality for an experienced writer, matching the user's stated preference for over-rather-than-under estimates. The floor is short-lived: a single completion produces real attributed timing and the global per-stroke average takes over, almost certainly at a different (likely higher, given the overhead the study excluded) value.
- Changing the floor requires a code change and a re-review of the research basis. That is intentional — it prevents silent drift and makes the prior auditable in git history.
- If real-data observations ever consistently show the global per-stroke average is *lower* than 500 ms/stroke (i.e., the assumed prior was heavier than reality), the floor becomes the maximum of (constant, global average) conceptually — except by our design, the global average replaces the floor the moment it exists, so the floor never holds back a lower estimate once data is present. The floor is the prior **only** before data; we do not floor the global average at the constant.