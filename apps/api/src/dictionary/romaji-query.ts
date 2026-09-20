/**
 * Macrons expand to the literal kana-sequence vowels the stored **Romaji
 * form** uses (ADR 0011): long あ/い/う sounds are written out, and え/お
 * sounds follow the kana sequence (ē → ei, ō → ou) rather than a length mark.
 */
const MACRON_EXPANSIONS = new Map([
  ['ā', 'aa'],
  ['ī', 'ii'],
  ['ū', 'uu'],
  ['ē', 'ei'],
  ['ō', 'ou']
]);

const APOSTROPHES = /['’]/g;

/**
 * Clean a Latin query before it is matched against the stored **Romaji form**
 * (ADR 0011): lowercase-fold, strip apostrophes, and expand macrons to literal
 * kana-sequence vowels. Pure and total — input needing no cleaning passes
 * through unchanged, and this is input hygiene, not loose matching (tokyo and
 * kohi stay non-matches). Particle-alternate generation (`romajiQueryVariants`)
 * builds on the cleaned query.
 */
export function cleanRomajiQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(/[āīūēō]/g, (macron) => MACRON_EXPANSIONS.get(macron)!);
}

/**
 * One query string to match against the stored **Romaji form**, plus whether
 * only the exact strategy applies. `exactOnly` exists for whole queries of
 * exactly `wa`/`wo`/`e`, where the particle alternate must not become a prefix
 * scan (`ha%` would match every reading starting with は, ADR 0011).
 */
export type RomajiQueryVariant = { value: string; exactOnly?: boolean };

const VOWELS = new Set(['a', 'i', 'u', 'e', 'o']);

/**
 * The pronunciation/typing form of each particle, keyed by the form a user
 * types: は stores as `ha`, を stores as `o`, へ stores as `he`.
 */
const PARTICLE_ALTERNATES = { wa: 'ha', wo: 'o', e: 'he' } as const;

/** Alternates are capped so pathological input cannot explode the strategy count. */
const MAX_ALTERNATES = 16;

type Substitution = { index: number; from: string; to: string };

/**
 * Particle substitutions for the cleaned query (ADR 0011): the stored Romaji
 * form is kana-literal, so particles are found by trying the pronunciation or
 * IME-typing form as an alternate. Non-initial `wa`→`ha` (は), `wo`→`o` (を
 * stores as `o`), and standalone non-initial `e`→`he` (へ) — an `e` is
 * standalone when the character before it is a vowel, so `te`/`de`/`hone`
 * stay untouched (the accepted ん gap in ADR 0011). A `wa` followed by a vowel
 * is almost always inside a word, not a particle, so `kawaii` stays whole.
 * Word-initial occurrences are never substituted, keeping wakaru/warau
 * noise-free. `exactStoredReading` is true when the cleaned query is itself an
 * exact stored reading (いえ/うえ/こえ/まえ); raising it disables only the
 * standalone `e`→`he` substitution, because that `e` belongs to the word, not
 * the particle へ, and the alternate would pull a lookalike in via its prefix.
 */
function eligibleSubstitutions(query: string, exactStoredReading: boolean): Substitution[] {
  const substitutions: Substitution[] = [];
  for (let index = 1; index < query.length; index += 1) {
    if (query.startsWith('wa', index) && !VOWELS.has(query[index + 2] ?? '')) {
      substitutions.push({ index, from: 'wa', to: PARTICLE_ALTERNATES.wa });
    } else if (query.startsWith('wo', index)) {
      substitutions.push({ index, from: 'wo', to: PARTICLE_ALTERNATES.wo });
    } else if (!exactStoredReading && query[index] === 'e' && VOWELS.has(query[index - 1] ?? '')) {
      substitutions.push({ index, from: 'e', to: PARTICLE_ALTERNATES.e });
    }
  }
  return substitutions;
}

/**
 * Build the cleaned query plus its particle alternates (ADR 0011). The cleaned
 * query always comes first and uses both exact and prefix strategies. Every
 * non-empty subset of the eligible particle substitutions yields one alternate,
 * enumerated by ascending bitmask over the eligible positions (left to right)
 * and applied right-to-left so earlier indices stay valid. Alternates are
 * deduplicated and capped at 16. A whole query of exactly `wa`, `wo`, or `e`
 * gets its alternate marked `exactOnly`.
 *
 * `options.exactStoredReading` drops the standalone `e`→`he` substitution
 * (wa→ha and wo→o are unaffected) when the cleaned query is itself an exact
 * stored reading — a real word like いえ/うえ/こえ/まえ whose final `e` is
 * part of the word, not the particle へ. Without the guard, `ie` would pull
 * いへん (異変) in via the `ihe%` prefix. Recall phrases with no exact stored
 * match (もとへ etc.) still get the alternate.
 */
export function romajiQueryVariants(
  query: string,
  options: { exactStoredReading?: boolean } = {}
): RomajiQueryVariant[] {
  const cleaned = cleanRomajiQuery(query);
  if (cleaned === '') {
    // Cleaning reduced the query to nothing (e.g. a lone apostrophe). There is
    // no romaji to match, and a `%` prefix scan would match every reading.
    return [];
  }
  const variants: RomajiQueryVariant[] = [{ value: cleaned }];
  const substitutions = eligibleSubstitutions(cleaned, options.exactStoredReading ?? false);

  for (
    let mask = 1;
    mask < 2 ** substitutions.length && variants.length <= MAX_ALTERNATES;
    mask += 1
  ) {
    let value = cleaned;
    for (let bit = substitutions.length - 1; bit >= 0; bit -= 1) {
      if ((mask & (1 << bit)) === 0) {
        continue;
      }
      const substitution = substitutions[bit]!;
      value =
        value.slice(0, substitution.index) +
        substitution.to +
        value.slice(substitution.index + substitution.from.length);
    }
    if (!variants.some((variant) => variant.value === value)) {
      variants.push({ value });
    }
  }

  if (cleaned === 'wa' || cleaned === 'wo' || cleaned === 'e') {
    const alternate = PARTICLE_ALTERNATES[cleaned];
    if (!variants.some((variant) => variant.value === alternate)) {
      variants.push({ value: alternate, exactOnly: true });
    }
  }

  return variants;
}
