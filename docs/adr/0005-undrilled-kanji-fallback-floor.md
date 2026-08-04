# Undrilled-kanji fallback uses a 0.6 s/stroke floor plus per-card padding, both code constants

## Context

When a never-drilled kanji has no attributed timing data and no same-stroke-count siblings, its write time is estimated by multiplying its stroke count by a **per-stroke coefficient**. Before any assignment has ever been completed, the global per-stroke average (which would supply that coefficient) is undefined. The estimate must display *something* on a fresh install, so a constant floor is needed.

The floor is replaced — not added to, not blended — the moment the first completion lands and the global per-stroke average has a real value. The floor is therefore purely the prior before data.

Real initial drilling sessions are not pure motor execution. They also include **card-dwell overhead**: reading the word's gloss, checking the stroke-order diagram, confirming whether the reading uses hiragana or katakana, and moving between cells. A pure per-stroke floor cannot capture this fixed per-card time, because it scales only with strokes. Early calibration from the maintainer's own fresh-install drilling showed the floor under-estimating simple single-kanji words as well as more complex words.

## Decision

Set the floor at **0.6 s/stroke (600 ms/stroke)**, stored as a **coded constant** in the TypeScript estimate module, and add a **10 s per-card padding** applied only when the Level-4 floor is active (zero completions anywhere). Both constants are in code — not in `app_config`, not in a `.env`, not in a settings row.

Research basis: Tamaoka, Phương, Zhang, Kawahara & Verdonschot (2026), *Frontiers in Language Sciences* — single-kanji handwriting durations among Vietnamese JFL learners aged 20-30, JLPT N1-N3, on a stylus-on-tablet task. Regression of writing duration on stroke count: intercept 3,826 ms at 8.58 mean strokes, with a visual-complexity coefficient of 1,481 ms per SD (3.89 strokes), giving a marginal of **~380 ms per stroke** for pure motor execution. The study deliberately excluded overhead that a real drilling session captures (card dwell time, reading glosses, looking at stroke-order diagrams).

Calibration against three maintainer-timed fresh-install drills:

| word | actual time | old floor (0.5 s/st) | new floor + 10s pad |
|---|---|---|---|
| 訓練 (24 stroke-writes, 4 kana) | 79s | 64s (−19%) | 86s (+9%) |
| 越える (60 stroke-writes, 13 kana, slower-than-usual) | 76s | 43s (−43%) | 65s (−14%) |
| 主 (50 stroke-writes, 2 kana) | 41s | 27s (−34%) | 42s (+2%) |

The 0.6 s/stroke + 10 s padding combination lands slightly above the two normal-pace observations and below the admitted slow-day observation, satisfying the project's "**round up when in doubt**" preference without making fresh-install estimates alarming.

## Considered Options

- **A. 0.6 s/stroke + 10s per-card padding, code constants (chosen).** Calibrates the floor against real in-app drilling while keeping a research anchor. The per-card padding captures overhead the pure per-stroke model cannot, and is only applied when no completion data exists to have already captured it.
- **B. 0.5 s/stroke, no padding (previous choice).** Rejected: under-estimated observed fresh-install times by 19–43% across simple and complex words.
- **C. 1 s/stroke, deliberately heavier.** Rejected: would make fresh-install estimates look alarming (`漢` estimated at ~14s per write alone, near a hundred seconds for a single undrilled word) and overshoots even the slow-day observation.
- **D. Per-kanji padding instead of per-card padding.** Rejected: the two normal-pace observations (訓練 and 主) imply a fixed per-card cost rather than a per-kanji cost; per-kanji padding would over-penalize multi-kanji words.
- **E. Config-stored coefficients in `app_config`.** Rejected: hides modelling decisions behind a settings surface. The `app_config` table is for things a user actually configures (per-machine paths, ports); research-derived priors don't belong there, and hidden rows invite drift when someone tunes them without understanding the research basis.

## Consequences

- Fresh-install numbers now sit above the maintainer's observed normal pace, matching the user's stated preference for over-rather-than-under estimates. The floor and padding are short-lived: a single completion produces real attributed timing and the global per-stroke average takes over, almost certainly at a different (likely higher, given the overhead the study excluded) value.
- Changing either constant requires a code change and a re-review of both the research basis and calibration data. That is intentional — it prevents silent drift and makes the prior auditable in git history.
- The padding is **only** applied in the Level-4 (zero-data) case. Levels 1-3 already inherit card-dwell overhead from the attribution data, so adding padding there would double-count.
- If real-data observations ever consistently show the global per-stroke average is *lower* than 600 ms/stroke, the floor is heavier than reality — except by our design, the global average replaces the floor the moment it exists, so the floor never holds back a lower estimate once data is present. The floor is the prior **only** before data; we do not floor the global average at the constant.
