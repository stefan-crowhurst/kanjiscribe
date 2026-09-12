# Script-folded readings collapsed at import

## Context

JMdict frequently lists the same reading twice — once in hiragana, once in katakana (`あっさり` / `アッサリ`). Of 215,805 entries in the live database, 9,130 surfaced such script-duplicate readings, all of them shown as separate options in the intake reading picker. The options are phonetically identical, so the choice is meaningless noise for the user — and two different script picks for the same word could silently create two study items, since `study_item`'s UNIQUE constraint compares raw text. The user's existing convention: when both scripts exist, always pick hiragana.

## Decision

Reading identity ignores kana script. At JMdict import, each entry stores one `entry_reading` row per script-identity: the hiragana variant when the entry has one, otherwise the katakana form as JMdict wrote it (genuine katakana words like `ダンス` and `コーヒー` have no hiragana twin and are untouched). Collapse is per identity group, per entry: groups are independent, a script pair never merges with an unrelated reading, and multiple pairs collapse independently (`カチカチ`/`かちかち` and `コチコチ`/`こちこち` each become one row). Phonetically distinct near-misses (`あかん`/`あかーん`, `カチカチ`/`カッチカチ`) are character differences, not script differences, and always survive. The kept row is the entry's primary reading if it is the first surviving row in dictionary order; reading restrictions (`entry_reading_spelling`) that referenced a dropped variant are remapped onto the kept one.

The existing database is refreshed by a one-time re-run of the JMdict import — the dictionary tables are a rebuildable cache, no study data is touched, and no study-item migration is needed (verified: no existing `selected_reading` references a dropped variant).

## Considered Options

- **A. Import-time collapse (chosen).** The invariant — one row per reading, hiragana-preferred — holds everywhere by construction: picker, search results, study-item uniqueness. Single choke point in the importer.
- **B. Read-time fold in the API (rejected).** No data change, but every surface that lists readings must remember to fold; the dupes persist in the DB forever; `study_item` uniqueness cannot rely on canonical identity.
- **C. UI-only fold (rejected).** Shallowest; the API contract keeps serving script variants to any future consumer.
- **D. Folded search column (`text_folded`) (rejected).** The bulletproof answer to script-insensitive search, but it adds schema, importer, and index churn to cover mixed-script query edge cases that effectively do not exist. Two-variant query matching covers the real cases.

## Consequences

- `entry_reading` deliberately diverges from JMdict (~9,130 fewer reading rows). This is not data loss to be fixed — do not "restore" the dropped variants.
- Search-by-reading folds the query into its hiragana and katakana variants and matches both (exact and prefix), taking the best match type. This is strictly better than the pre-fold behavior, where a script mismatch failed to match at all.
- Intake normalizes `selected_reading` through the same fold, so "a study item's reading is a canonical reading of its entry" is enforced at the write path, not just by the current picker UI.
- The fold is a per-character katakana→hiragana mapping (U+30A1–U+30F6, including small kana and ヴ→ゔ; ー and ・ pass through unchanged). It defines identity only — the kept variant's own text is stored as-is, so mixed-script readings without a hiragana twin keep their original form.
