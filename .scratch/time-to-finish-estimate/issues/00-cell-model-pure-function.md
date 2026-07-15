# Cell model pure function

Status: ready-for-agent

## Parent

`.scratch/time-to-finish-estimate/PRD.md`

## What to build

A pure function that takes a study item's surface form, the positions and stroke counts of its kanji, and its selected reading, and returns the per-character write counts and the total kana writes across the 10-cell layout, including the reading-writing first-copy addition.

The input is `(surface_form: string, kanji: Array<{ position: number, stroke_count: number }>, selected_reading: string)`. The output is `{ per_char_writes: Map<number, number>, kana_writes_total: number }` where `per_char_writes` keys are character positions in the surface form and values are how many times that character is written, and `kana_writes_total` includes both surface kana writes and the reading-writing kana writes.

The algorithm follows the **writing cell model** from `CONTEXT.md` and ADR-0003:

1. Walk the surface form left-to-right. Each kanji occupies 1 cell. Adjacent runs of non-kanji characters (the **kana unit** concept from `CONTEXT.md` — hiragana, katakana, Latin, digits, punctuation all treated uniformly) pair into cells of at most 2.
2. `cell_cost = total cells for one clean copy`. `N = floor(10 / cell_cost)`. `remainder_cells = 10 - N * cell_cost`.
3. Each character in the surface form is written N times during the clean copies.
4. Fill the remainder cells with the highest-write-time-first characters:
   - Sort the word's kanji by known per-write time descending (longest first), tie-break by leftmost position. If no per-write time is known (fresh install, no attribution data yet) use stroke count descending.
   - Fill one kanji per remainder cell, repetition allowed (a single kanji can fill multiple remainder cells, e.g. a one-kanji word with 2 remainder cells writes that kanji twice more).
   - Only if the word has no kanji (kana-only word), or if the remainder exceeds the kanji set entirely, fill the remaining cells with kana units at 2 per cell.
5. Reading-writing addition: on the first clean copy only, the selected reading is written out in kana alongside the surface form, for every surface character including ones that are already kana (a surface kana is written again as its own reading). Add `len(selected_reading)` to `kana_writes_total`.
6. `cell_cost > 10` case: `N = 0`. Fill all 10 cells using the remainder-fill rules directly.
7. Surface kana writes are tracked in `per_char_writes` (each surface kana position gets N writes plus any remainder writes); reading-writing kana writes are tracked only in the `kana_writes_total` total, not in `per_char_writes` (they don't have a surface position to key them to).

This translates the grilling resolutions on adjacent-kana pairing, remainder tie-breaks (longest-known-time then leftmost), kanji repetition in remainder, kana-only remainder packing (2-per-cell), reading-writing first-copy adds, the `cell_cost > 10` fallback, and mixed Latin/digits/punctuation as kana units.

The per-write-time input is optional — when grading remainder kanji for tie-break position, if the caller has no known per-write times it passes an empty list and the fallback uses stroke count descending. This keeps the pure function independent of the attribution views and testable in complete isolation.

## Acceptance criteria

- [ ] Pure function exposes no I/O, DB reads, HTTP, or side effects — its only inputs are the function arguments.
- [ ] Single-kanji word with kana (e.g. `迫る`, reading `せまる`, 迫 at position 0 with N strokes) returns 迫 written 5 times, る written 5 times, `kana_writes_total = 5 + 3 = 8` (5 surface + 3 reading-writing from `せまる`).
- [ ] Kana-only word (e.g. `ありがとう`, same reading) returns each kana written 3 clean-copy times + remainder writes, with `kana_writes_total` accounting for both surface and reading-writing writes.
- [ ] Single kanji word with no kana (e.g. `山`, reading `やま`) returns that kanji written 10 times, `kana_writes_total = 2` (reading-writing only, surface kana is 0).
- [ ] `cell_cost > 10` word returns N=0 and fills all 10 cells with remainder-fill kanji (highest stroke count first), repeating as needed.
- [ ] Multi-kanji word remainder tie-break uses longest known per-write time first; when no per-write times are known, uses highest stroke count; ties at equal stroke count go to leftmost position.
- [ ] Kana-only word remainder packs kana units 2 per cell.
- [ ] Non-kanji Latin/digits/punctuation in a surface form pair into cells exactly like kana (2 per adjacent cell) and count 1 s per write in `kana_writes_total`.
- [ ] Reading-writing addition is applied once (not per clean copy) — adds exactly `len(selected_reading)` kana writes regardless of how many clean copies the word has.
- [ ] Unit tests at the new pure-function seam cover each edge case above as a direct function call, no DB or HTTP seeding.

## Blocked by

None - can start immediately.

## Comments

## Answer

Implemented `computeCellWrites` in `packages/shared/src/cell-model.ts` as a pure function with no I/O or side effects. Added unit tests in `packages/shared/src/cell-model.test.ts` covering all acceptance criteria, plus Vitest infrastructure in `packages/shared`. All shared/api tests pass; `packages/importer` has a pre-existing type error unrelated to this change.

Note: the spec contains an ambiguity between "repetition allowed" for kanji remainder cells (issue line 22 / PRD line 75) and "fill remaining cells with kana if remainder exceeds the kanji set entirely" (issue line 23 / PRD line 76). The implementation follows the explicit "repetition allowed" example: a single kanji can occupy multiple remainder cells, and mixed words never divert remainder cells to kana.
