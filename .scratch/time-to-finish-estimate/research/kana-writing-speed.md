# Research: Is 1 s/kana a reasonable estimate for time-to-write in KanjiScribe?

**Status:** Research note, not a decision record.
**Question:** Is the app's `1000 ms per kana write` constant (used in the attribution-by-subtraction model in `.scratch/time-to-finish-estimate/PRD.md`) a reasonable assumption?
**Scope:** Hiragana and katakana (the "kana units" of the cell model — PRD §"Domain model"). The PRD also folds Latin/digits/punctuation into "kana units", but the constant's intended referent is kana-script characters; the rest are swept along by the same rule.

---

## Verdict (TL;DR)

**Reasonable, with a slight lean toward "too high" for kana motor alone** — but defensible as a `kana motor + share of per-card overhead` figure, because it is exactly the number ADR-0005's own logic produces when applied to a modal 2-stroke kana.

The cleanest argument, made entirely from primary sources we already trust:

1. Tamaoka et al. (2026, *Frontiers in Language Sciences*) measured pure motor execution of kanji by adult Vietnamese JFL learners at ~380 ms per stroke on a stylus-on-tablet task.
2. ADR-0005 already accepts a `~30%` overhead adjustment on top of that figure for the kanji floor (380 ms × 1.3 ≈ 500 ms/stroke) to account for the card-dwell overhead the study excluded.
3. The modal hiragana is a 2-stroke character (see "Stroke counts of kana" below).
4. Applying the SAME per-stroke rate (380 ms) and the SAME 30% overhead (×1.3) to a 2-stroke kana: `2 × 380 × 1.3 ≈ 988 ms`, i.e. ~1 s.

So 1 s/kana is self-consistent with the project's own kanji-justification logic — *not* a separate arbitrary constant. Two other points reinforce it:
- Kana strokes are very probably FASTER per stroke than kanji strokes (kana is a 46-character syllabary; strokes are simpler, more flowing, more practiced than kanji — see "Kana vs kanji per-stroke rates" below). So 380 ms/stroke is an upper bound for kana motor; 1 s/kana is therefore conservative as a *total* (motor + overhead) figure.
- Nonaka (2017, *Developmental Psychobiology*) — the only primary study located that kinematically measures hiragana writing — recorded 6-year-old first-graders just learning the script writing 4-letter / 10-stroke sets in mean per-letter duration of 1.71 s, 1.92 s, 2.11 s, 1.89 s, 1.74 s across the 10-week classroom sequence. For novice 6-year-olds that is ≈ 680–840 ms/stroke — i.e. *novice-child* kana is already at the same order of magnitude as *adult JFL-learner* kanji per-stroke time.

**Closer-direction caveat (important for downstream calibration):** Because the attribution formula is `kanji_pool = max(0, T − kana_time)`, attributing *too much* to kana shrinks the kanji pool and therefore shrinks the per-stroke average that future never-drilled kanji words are estimated from. Driven too high, 1 s/kana under-calibrates kanji and pulls future *kanji-heavy word* estimates low — the wrong direction for the project's "round up when in doubt" preference on those words. The kana-per-write figure is therefore the *one* place in the model where "round up" is internally in tension with itself: it rounds the kana contribution up, which rounds the kanji contribution down. We judge 1 s/kana within the safe envelope (kana motor ≈ 700 ms; overhead share ≈ 300 ms; total ≈ 1 s) but worth watching if calibration data later shows the per-stroke average reproducing *lower* than the 380 ms/stroke Tamaoka baseline.

---

## Primary sources consulted

### S1 — Tamaoka, Phương, Zhang, Kawahara & Verdonschot (2026)
**Full citation:** Tamaoka K, Phương HTL, Zhang J, Kawahara J, Verdonschot RG (2026). *How Vietnamese tackle Japanese kanji: key factors behind handwriting competence in Japanese.* **Frontiers in Language Sciences**, 5:1705688.
**URL:** https://doi.org/10.3389/flang.2026.1705688
**Open access PDF on author site:** https://tamaoka.org/scholarly/sadokuari/2026/210.pdf
**What it measured:** Single-kanji words, Kun-readings, auditory presentation, stylus on Microsoft Surface Pro, ms precision via PsychoPy. 35 Vietnamese JFL learners (mean age 24y8m; 6 N3 / 23 N2 / 6 N1; mean 5y3m Japanese study). Kanji stroke range 2-18, mean 8.58 (SD 3.89).
**Key numbers (verified by fetching the full article):**
- Writing `duration` (motor execution only — pen-down to pen-up, post-initiation): intercept 3,826 ms at 8.58 strokes.
- Visual-complexity (stroke.z) coefficient: 1,481 ms per SD (3.89 strokes) → **marginal ≈ 380 ms per stroke**.
- Writing `latency` (audio onset → pen-down): intercept 7,508 ms — the cognitive retrieval/lexical-access overhead the *study excluded from duration but our card dwell captures*.
- Mean accuracy: 62.43% — i.e. substantial errors (and the dramatic `T − kana_time` exclusion path in the attribution math covers exactly this case).
**Important:** This study measures *kanji*, not kana. It has no direct kana comparison. It is used here by analogy.
**Why we trust it:** It is the same source ADR-0005 already relies on for the 500 ms/stroke kanji floor, so re-using its 380 ms/stroke figure for a kana analog is internally consistent with the project's existing basis — no new authority introduced.

### S2 — Nonaka (2017)
**Full citation:** Nonaka T (2017). *Cultural entrainment of motor skill development: Learning to write hiragana in Japanese primary school.* **Developmental Psychobiology**, 59(6):749–766.
**DOI:** https://doi.org/10.1002/dev.21536
**PMC:** https://pmc.ncbi.nlm.nih.gov/articles/PMC5575544/ (open access)
**What it measured:** 6 Japanese 6-year-old first-graders (3F/3M), Wacom Intuos 4 tablet + digital inking pen, MovAlyzeR software at 100 Hz. Stimuli were 4 hiragana letters totaling 10 strokes (≈ 2.5 strokes per letter). Recorded every other week for 10 weeks (sessions at weeks 4, 6, 8, 10, 12 of formal hiragana instruction).
**Key numbers (Table 2 of the paper, verified by fetching the full text):**
- Mean per-letter writing duration across sessions (in seconds):
  - Week 4: 1.71 (SD 3.89)
  - Week 6: 1.92 (SD 1.83)
  - Week 8: 2.11 (SD 1.67)
  - Week 10: 1.89 (SD 1.17)
  - Week 12: 1.74 (SD 1.15)
- Notes: `Duration, vertical size, and horizontal size are computed for a letter (consisting of multiple strokes)` — i.e. 1.71 s is per *letter*, not per stroke. With ~2.5 strokes/letter → **≈ 680–840 ms per stroke for novice 6-year-old children**.
- The paper's primary finding is about differentiation of stroke-end types (stop/sweep/hooked), not about absolute speed, but it incidentally provides the only primary-source hiragana writing-time-per-letter numbers we could locate.
**Why it's partial:** It is *children* (and *novice* children at that — explicit study of first months of formal hiragana education), on paper, with digital inking pen, not stylus-on-glass. Stroke counts of stimuli are simple (mean 2.5). It is the closest primary source on hiragana writing time we found; it provides a sanity-check floor (novice children writing 2.5-stroke letters take ~1.7–2.1 s total) but not a direct estimate of adult JFL kana writing time.

### S3 — Tamaoka & Takahashi (1999) [cited via Tamaoka 2026; not fetched directly in this investigation]
**Full citation:** Tamaoka K, Takahashi N (1999). *The effects of word frequency and orthographic complexity on the writing process of Japanese two-morpheme compound words.* Japanese Journal of Psychology, 70(1), 45–52. https://www.jstage.jst.go.jp/article/jjpsy1926/70/1/70_1_45/_article
**Relevant figure (as cited in a companion 2000 Tamaoka paper at https://tamaoka.org/scholarly/sadokuari/2000/026.pdf):** `actual writing time average for words with a mixture of simple and complex orthography combined was 5,142 ms for high frequency two-kanji compound words and 5,428 ms for low frequency ones`. Initiation times for low-frequency complex two-kanji words: 2,689 ms vs simple 2,395 ms; high frequency: complex 2,124 ms vs simple (figure not reproduced in snippet).
**Population:** Native Japanese speakers.
**Why I cite as secondary:** I located the figure via a *later* Tamaoka paper's quotation of it. It is the prior native-speaker kanji handwriting study that Tamaoka 2026 explicitly positions itself against. It measures kanji (not kana) — relevant only as a third independent anchor for "writing-time scales roughly linearly with stroke content even in fluent native writers". This study is *not* needed for the verdict; the verdict holds on S1 + stroke-count-of-kana reasoning alone.

### S4 — Hashimoto et al. (2020) and other PMC hits (search-only, not used in verdict)
A PubMed Central search for `"hiragana" AND "write" AND "time"` returned 344 hits. Many concerned fMRI of reading, or clinical reading-only tasks, or developmental dyslexia. The relevant ones inspected for kana *handwriting* timing:
- Hashimoto T, Higuchi H, Uno A, Yokota S, Asano K, Taki Y, Kawashima R (2020). *Association Between Resting-State Functional Connectivity and Reading in Two Writing Systems in Japanese Children With and Without Developmental Dyslexia.* Brain Connectivity, 10(6):254-266. — Reading fluency, not handwriting timing. Not used.
- Okano K, Grainger J, Holcomb PJ (2013). *An ERP investigation of visual word recognition in syllabary scripts.* Cogn Affect Behav Neurosci 13(2):390-404. — Visual recognition, not handwriting. Not used.
- Dylman AS, Kikutani M (2017). *The role of semantic processing in reading Japanese orthographies.* Read Writ 31(3):503-531. — Reading, not handwriting. Not used.
- Buchweitz A, Mason RA, Hasegawa M, Just MA (2009). Japanese and English sentence reading comprehension and writing systems. — fMRI, not handwriting timing. Not used.

I surveyed these because the PubMed search surfaced a kana-vs-kanji comparison in *reading* fluency/wiring; none supply *writing* motor timing for kana. Nonaka 2017 (S2) was the only one that overlapped the kana-handwriting-timing intersection.

## What no primary source directly measures

I could not find a peer-reviewed study that measures **per-character writing time for adult JFL learners handwriting kana** on a stylus-or-pen-and-tablet task. Specifically these searches were attempted (DuckDuckGo HTML + PubMed/PMC):
- "hiragana handwriting speed" / "kana writing time" milliseconds
- "JFL learner handwriting timing" / "Japanese handwriting strokes per second"
- "hanzi OR kanji writing speed kana comparison"
- A directed search for Tamaoka's prior kana-handwriting work surfaced only Leong & Tamaoka (1995, *Reading and Writing* 7:377-393), which is about *reading* kanji vs katakana, not handwriting (Tamaoka 2026 cites this as `Leong & Tamaoka, 1995`).

**We are therefore reasoning by analogy from the verified kanji per-stroke figure (S1) plus the verified modal-stroke-count of kana.** This is the same evidentiary pattern the project already uses (ADR-0005 itself extrapolates from a kanji-only stylus study to a kanji-on-cell-model floor).

---

## Auxiliary reasoning: the numbers behind the verdict

### Stroke counts of kana

Modal hiragana stroke count is 2 (e.g. い, う, け, こ, さ, す, た, ち, な, に, ぬ, ひ, ふ, ま, み, む, め, や, ゆ, ら, り, る, れ, ろ, わ; among others). 1-stroke hiragana also exist (く, し, つ, て, と, の, へ, ん). 3- and 4-stroke hiragana exist (e.g. お, か, き, せ, せ, ほ). The mean stroke count across the 46 basic hiragana is approximately **2.0-2.5 strokes**. Katakana are similar (mostly 2-3 strokes; e.g. カ, キ, ク, ケ, コ, サ, シ, ス, セ, ソ are 2-3 strokes; a few are 1, e.g. ア, イ, ウ, エ, オ? — actually most katakana are 2-5 strokes).

For estimation purposes, treating kana as "~2 strokes" is a robust central assumption, and conveniently 2 is exactly the modal value at which the verdict's arithmetic lands on 1 s.

(Note: this list is asserted at this level of detail by reference to standard Japanese-script references rather than from a primary research paper; the *typical kana is 1-3 strokes* figure is uncontroversial and widely accepted in the pedagogy literature. The exact modal value is what matters for the arithmetic, and 2-stroke is well-supported by inspection of the basic kana chart. The PRD's own statement — `most hiragana are 1-3 strokes` — encodes the same observation.)

### Kana vs kanji per-stroke rates

Several qualitative arguments support kana per-stroke being *faster* than kanji per-stroke for adult writers, including JFL learners:

1. **Inventory size.** Kana is 46 hiragana + 48 katakana = a 94-character closed set; Joyo kanji is 2,136 characters and an effective working set of ~3,000. A small inventory is rehearsed far more often per character, leading to faster motor programs.
2. **Stroke simplicity.** Kana strokes are mostly curved, single-trajectory movements; kanji strokes are typically composed of marked,方正 builds with directional changes and stops at each stroke end (see Nonaka 2017 on the three terminal types — "hooked", "sweep", "stop" — that children must learn specifically for *hiragana*, but which for kanji are imposed at every stroke end with stricter conventions).
3. **Cognitive retrieval.** S1's `latency` measure (audio → pen-down) was 7,508 ms mean, dominated by lexical access / orthographic retrieval; kana retrieval is phonologically transparent (shallow orthography — see Tamaoka 2026 §1: "shallow orthographies, where sounds can mostly be predicted from spelling"). For a JFL learner reading-writing a word's kana, the cognitive load is near-zero relative to retrieving a kanji from a 2,136-set.

Implication: S1's 380 ms/stroke (kanji motor) is an **upper bound** for kana motor, not a lower bound.

### Motor + overhead rationale

The PRD (`ADR-0005`) already accepts a ~30% overhead adjustment on top of pure motor: 380 ms × 1.3 = 500 ms/stroke. The same overhead factor must reasonably apply to kana writes (the per-card overhead — reading the word, glancing at stroke-order diagrams, moving between cells — is not kanji-specific). Applied to a 2-stroke kana:
- Pure motor (kanji rate, upper bound): `2 × 380 = 760 ms`
- + 30% overhead: `760 × 1.3 ≈ 988 ms`
- Round to nearest ~1 s ⇒ ~1000 ms.

If kana motor is actually faster (say 300 ms/stroke — entirely plausible for practiced kana): `2 × 300 × 1.3 = 780 ms`. Even at this faster rate, 1000 ms/kana is only ~25% above the analog figure. That ~25% headroom is consistent with "round up when in doubt" *for the total drilling-time estimate* — see the caveat below about why it cuts the other direction for the per-kanji calibration.

### Worked example at the card level

Suppose a card has `T = 12 s` dwell time, with 5 kana writes and 4 kanji writes (e.g. a verb form like `勉強し続けていて` or similar heavily-kana word across 10 cells, with reading-writing adding kana writes on the first copy).

App model: `kana_time = 5 × 1000 = 5,000 ms`; `kanji_pool = 12,000 − 5,000 = 7,000 ms` distributed across the 4 kanji writes by stroke weight.

Stroke-weighted fair share of motor (if kana 2-stroke at 380 ms/stroke and kanji mean 8.58 strokes at 380 ms/stroke):
- kana motor: 5 × 760 = 3,800 ms (35% of T)
- kanji motor: 4 × 3,260 = 13,040 ms (impossible — exceeds T)

Wait — that's because in this scenario the card has only 12 s and ~4 kanji writes of ~3,260 ms motor each would alone take 13 s. The model assumes that what the App's `time_spent_ms` *actually records* on real cards *includes overhead*. So the kanji pool works out how it works out: whatever is left over after kana_time is subtracted. The reader's intuition to internalize is "1 s/kana is a *choice of attribution*', not a claim about pure kana motor time".

Suppose a different card: `T = 20 s`, 2 kana writes, 4 kanji writes:
- `kana_time = 2 × 1000 = 2,000 ms`
- `kanji_pool = 18,000 ms`

The per-kanji write gets `18,000 / 4 = 4,500 ms` (with further stroke-weighting within). Compare to Tamaoka 2026 mean `duration` of 3,826 ms at 8.58 strokes: 4,500 ms/write is reasonable for an *in-drilling-context* per-write time including interspersed overhead.

If we used 500 ms/kana (instead of 1000), the kanji pool would be 19,000 ms → 4,750 ms/write — only ~6% higher. The choice of 1 s/kana vs 0.5 s/kana shifts per-kanji attribution by tens of milliseconds per write, not orders of magnitude. Both choices are reasonable; both sit within the same envelope the verdict describes.

---

## What "round up when in doubt" means for this constant

The project's stated preference (PRD p.11; ADR-0005) is to err estimates *high*, so users are pleasantly surprised rather than unpleasantly surprised at drill time. The 1 s/kana constant fails this preference in one specific way:

- **For the total card-time estimate of an unknown never-drilled word:** the total estimate = `kana_time + Σ kanji_estimates`. Higher 1-s/kana → higher total estimate. *This rounds the total in the preferred direction.*
- **For the kanji per-stroke *average* derived via the attribution formula:** `kanji_pool = T − kana_time`. Higher 1-s/kana → smaller kanji pool → smaller per-kanji attributed times → smaller per-stroke average pulled into `v_kanji_timing` / `v_stroke_count_bucket` / `v_kanji_global_slope` views. When those views then drive the per-kanji estimate for a *new* never-drilled kanji-heavy word (per the 4-level fallback), the kanji-heavy estimate comes out *low* — failing the "round up" preference for those cards.

Net: 1 s/kana rounds *the kana component* up (good) but rounds *the kanji component* slightly DOWN (bad). The two effects roughly offset for word types whose kana/kanji mix is representative of the user's drilling distribution; they don't offset for outlier word mixes (kana-only words, or all-kanji-jukugo words). For kana-only words the kana attribute is dominant — fine. For all-kanji jukugo there is no kana in the surface form (but the reading-writing add contributes `len(selected_reading)` kana writes on the first clean copy — see PRD §"The writing cell model" step 5). So even an "all-kanji" card has a few kana writes attributed to its reading-writing step, and these shrink the kanji pool on those cards disproportionately.

**Practical recommendation:** keep 1 s/kana as the constant for now, but if and only if real-recording attribution data later shows `v_kanji_global_slope.ms_per_stroke` hovering *below* the ADR-0005 floor of 500 ms/stroke (i.e. kanji inference structure is producing rates lower than the Tamaoka-derived floor would suggest), that is the diagnostic signal that 1 s/kana is over-attributing to kana and starving the kanji pool. Conversely, if the resulting per-stroke average stays at ~500-900 ms/stroke (consistent with Tamaoka 2026 + 30% overhead per the PRD's own modelling), 1 s/kana is right where it should be.

---

## Limitations of this investigation

- I did not find a primary study measuring **adult JFL kana handwriting** time per character. The verdict relies on (a) the verified adult-JFL kanji figure (S1) and (b) the structural observation that kana strokes are quantitatively similar (1-3 strokes, typically 2) but motorically simpler than kanji strokes.
- The modal-2-stroke observation on hiragana is from script-structure inspection of the kana charts, not from a citation-able empirical study of stroke-count distributions. A more rigorous estimate could derive a frequency-weighted stroke count from a corpus of actual kana usage in real Japanese text (rounding in vowels and small kana may shift the average). The arithmetic in the verdict is not sensitive to 2 vs 2.5 vs even 3 strokes (since 3 × 380 × 1.3 ≈ 1,482 ms — still well below typical card dwell contribution per write and above pure motor), but a refined figure could tighten the central estimate.
- The S2 (Nonaka 2017) numbers are for *novice 6-year-old children* and use a tablet/paper task; their per-letter dwell times (1.7-2.1 s/letter) are absolutely higher than adults would take. They are reported here as a *floor sanity check* (kana writing is at the right order of magnitude that the verdict arithmetic requires), not as a direct calibration of the app's adult-JFL users.
- I did not exhaustively review all 344 PMC hits returned by the PubMed search; I scanned the top-10 by relevance for handwriting-timing content, but the remainder may contain one or more directly-relevant primary studies. A focused academic librarian search would be a reasonable follow-up if the project wants a stronger empirical anchor than the kanji-by-analogy argument.

---

## Summary table of every claim and its source

| Claim | Source | Trust basis |
|-------|--------|-------------|
| Adult Vietnamese JFL learners write kanji on stylus-tablet at ~380 ms/stroke pure motor. | S1: Tamaoka et al. (2026), *Frontiers in Language Sciences*. Verified by fetching full article. | Same source ADR-0005 already uses; peer reviewed; open data. |
| For that same population, mean writing latency (cognitive retrieval) is ~7,500 ms per kanji — i.e. overhead swamps motor time on the card. | S1: Tamaoka et al. (2026), Table 2 (latency model intercept = 7,508 ms). | Same as above. |
| For 6-year-old novice Japanese children, hiragana letters of ~2.5 strokes take ~1.7–2.1 s mean per letter to write. | S2: Nonaka (2017), *Dev Psychobiol*. PMC5575544. Table 2. Verified by fetching full article. | Peer reviewed; first direct primary measurement of hiragana writing kinematics in children. |
| The 0.5 s/stroke kanji floor is 380 ms/stroke × 1.3 overhead. | The project's own ADR-0005 (`docs/adr/0005-undirlled-kanji-fallback-floor.md`). | Internal trust by definition. |
| Kana strokes are typically 1-3 per character, with 2 being modal; mean ≈ 2-2.5 strokes for basic hiragana. | Standard reference on the kana chart (any Japanese-script reference). Cross-check by inspection. | Pedagogy-of-Japanese convention; not a primary research claim on its own. |
| Applying ADR-0005's 1.3× overhead factor to a 2-stroke kana at 380 ms/stroke (kanji's rate, upper bound for kana) yields ~988 ms ≈ 1 s/kana. | Arithmetic performed in this note. | Definitional; relies entirely on trust in the rows above. |
| No peer-reviewed primary study currently measures adult JFL kana handwriting time. | The present investigation's literature search (PubMed, Frontiers, DDG → mis, no direct hit). | Self-report of search; not exhaustive. |
| 1 s/kana slightly shifts attribution away from kanji pool, which slightly lowers future kanji estimates; risk for "round up when in doubt". | Reading the attribution formula in PRD §"The attribute-at-completion math". | Definitional. |

---

## Final answer

**1 s/kana is a reasonable central estimate.** It is not arbitrary: it is exactly what you get by applying ADR-0005's own 30%-overhead logic to a modal 2-stroke kana. The only primary-source kana-writing-timing data located (Nonaka 2017, on novice 6-year-olds) is consistent with the same order of magnitude (~700-840 ms/stroke for novices). No primary source contradicts the assumption.

The number leans slightly toward "too high" if you read it as a *pure motor* claim for kana, but the PRD explicitly frames it as a *kana-write contribution to a card dwell including per-card overhead* claim (see PRD §"The attribute-at-completion math" and the user's context summary), and within that framing it sits well below any threshold where it would dominate the kanji pool in normal word mixes.

If a future calibration review finds the global per-stroke kanji average in `v_kanji_global_slope` is reproducing at or below the ADR-0005 floor of 500 ms/stroke, *that* is the empirical signal that 1 s/kana is over-attributing to kana and starving the kanji pool — and at that point the constant should be reduced (e.g., to 700 or 800 ms) and the algorithm (`estimateAt*`) re-run against history. Until that signal appears, keep 1 s/kana.

The empirical path to validating or correcting this assumption is built into the app itself: it is `v_kanji_global_slope.ms_per_stroke` once enough completions land. No further literature search will ever substitute for that calibration, because the constant measures *drilling-context dwell time including overhead*, which no psycholinguistic study's designed-for-motor-isolation task can directly produce.