# Per-kanji drill time is derived by stroke-weighted attribution, not equal split

## Context

The time-to-finish estimate needs per-kanji write times to drive its fallback chain (drilled kanji → same-stroke-count siblings → global per-stroke average). The DB only records `time_spent_ms` at the assignment (word) level — there is no per-kanji timing. So per-kanji times must be *derived* from word-level totals by splitting each completed word's time across its kanji.

## Decision

Split the **kanji time pool** (`time_spent_ms` minus kana time, where kana time = `(surface_kana_writes + len(selected_reading)) × 1000 ms`) across the word's kanji in proportion to each kanji's `writes × stroke_count`:

```
per_kanji_per_write_time = kanji_pool × stroke_count[k] / Σ(writes[k] × stroke_count[k])
```

Store one `kanji_attribution` row per (completed assignment × kanji in that word) with `(assignment_id, kanji_literal, stroke_count, writes_count, attributed_time_ms)`. Per-kanji mean per-write time is then a SQL view grouped by `kanji_literal`.

## Considered Options

- **A. Stroke-weighted split (chosen).** A 20-stroke kanji in a word with a 4-stroke one gets 5× the share. Preserves a relative stroke signal in the derived per-kanji data, which is exactly the signal the same-stroke-count and global-per-stroke fallbacks are trying to exploit.
- **B. Equal split.** `per_kanji_time = kanji_pool / total_kanji_writes`, ignoring strokes. Rejected: flattens the very stroke signal the fallback chain depends on. A 20-stroke kanji and a 3-stroke kanji drilled together would both inherit the word's average; the same-stroke-count bucket would then mix genuine 3-stroke time with misattributed 20-stroke time, contaminating the fallback.
- **C. Kana-first subtraction + equal split.** Same as B but with kana time subtracted off the top. Operationally subsumed by A (A also subtracts kana time first); included only for completeness. Rejected for the same reason as B.

## Consequences

- Within a single word the derived per-write times lie on a line through the origin (`per_write = slope_word × stroke_count`), where `slope_word` varies per word. The global per-stroke average (Level-3 fallback) is then a weighted average of per-word slopes — same shape as the attribution model, so the fallback composes coherently with the data that feeds it.
- Assignments where `time_spent_ms < kana_time` (e.g. a 1-second skip-as-complete, or a timer that under-measured) yield `kanji_pool = 0` and are **excluded from per-kanji attribution entirely** — a zero attribution would pull the kanji's mean down without representing real handwriting time. The exclusion is silent and in-app; no rows are written for that assignment.
- A future maintainer who "simplifies" this to equal-split will silently destroy the stroke signal the fallback chain depends on. This ADR exists to prevent that change without considering why stroke-weighting was chosen.
- See ADR-0004 for the persistence shape that supports this attribution model.