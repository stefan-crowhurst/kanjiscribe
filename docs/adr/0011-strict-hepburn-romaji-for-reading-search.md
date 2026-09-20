# Strict Hepburn romaji stored for reading search

## Context

Intake search only matched `entry_spelling.text` and `entry_reading.text` (exact/prefix; script-insensitive since ADR 0010), so a Latin query returned nothing. The request "search with English text" clarified to mean **romaji**, not English: finding a word by typing a romanized reading (`taberu`, `toukyou`) without a kana IME. English gloss search was explicitly ruled out.

## Decision

Store one `romaji` form per `entry_reading`, produced by a strict Hepburn transliteration: n for ん, doubled consonants for っ, literal vowel sequences for long sounds (toukyou, koohii, sensei), ji/zu for ぢ/づ, o for を, iteration marks and ゟ expanded, halfwidth kana normalised. Search matches it exact and prefix, mapped onto the existing `exact_reading`/`prefix_reading` tiers and run alongside the kana strategies. Queries are cleaned (lowercase, apostrophes stripped, macrons expanded: tōkyō → toukyou) and then three **particle alternates** are also tried, because the stored form is kana-literal while particles are pronounced and typed differently: non-initial `wa`→`ha` (は), except a `wa` that runs into a following vowel (かわいい stays whole, not かはいい); `wo`→`o` (を), standalone non-initial `e`→`he` (へ), skipped when the literal query is itself an exact stored reading (so ie/ue/koe/mae stay words rather than matching いへん, うへっ, こへい, まへん), and combined up to a cap. A whole query of exactly `wa`/`wo`/`e` also tries its alternate for exact matching only. Word-initial substitutions are never made, so wakaru/warau stay noise-free. Nothing looser matches: tokyo, kohi, ramen, shimbun, susi do not.

## Considered Options

- **Gloss (English meaning) search — rejected.** The initial reading of the request; would have needed tokenizing `entry_sense.glosses_json` plus FTS5 or a token table. Dropped once "English text" was clarified as romaji.
- **Loose fold-both-sides matching — rejected.** Collapsing long vowels and folding Kunrei spellings would make kohi/tokyo/ramen/susi match, at the cost of rules with fuzzier semantics. Strict Hepburn chosen for predictability.
- **Parsing the query back to kana instead of storing romaji — rejected.** Romaji→kana is ambiguous (kan = かん/かな; koohii = こおひい/こうひい/こーひー) and partial syllables branch into multiple candidates; a stored column is deterministic and indexable.
- **Stored wa/e variants or a greeting exception list — rejected.** Query-side particle alternates keep exactly one kana-literal form per reading and generalise こんにちは/こんばんは to every は/へ/を particle phrase.

## Consequences

- `entry_reading` gains a derived, rebuildable column. The importer writes it on every reading insert, and its schema-ensure step adds the column and index when missing; `0001_initial.sql` carries the column for fresh databases; migration `0008_entry_reading_romaji.ts` adds the column if missing, creates the `idx_entry_reading_romaji` index, and backfills NULLs — all idempotent, on every boot.
- `CONTEXT.md` defines **Romaji form**; "English" is not the term for it, and English glosses are not searched.
- Accepted recall gaps: kohi, tokyo, ramen, shimbun, susi; word-initial particle substitutes; へ after ん without the consonant typed (`hone` remains 骨, not 本へ).
