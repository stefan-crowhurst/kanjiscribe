/**
 * Macrons expand to the literal kana-sequence vowels the stored **Romaji form**
 * uses (ADR 0011). あ/い/う long sounds are written out; え/お follow the kana
 * sequence (ē → ei, ō → ou) rather than a length mark.
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
 * Cleans a Latin query before matching the stored **Romaji form** (ADR 0011):
 * lowercase-fold, strip apostrophes, expand macrons to literal kana-sequence
 * vowels. Purely hygienic — `tokyo`/`kohi` stay non-matches — and
 * `romajiQueryVariants` builds on the result.
 */
export function cleanRomajiQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(/[āīūēō]/g, (macron) => MACRON_EXPANSIONS.get(macron)!);
}

/**
 * One query string to match against the stored **Romaji form**, plus whether
 * only the exact strategy applies. `exactOnly` guards whole-query
 * `wa`/`wo`/`e` alternates, which must not become `ha%`-style prefix scans
 * (ADR 0011).
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
 * Particle alternates for the cleaned query (ADR 0011): non-initial `wa`→`ha`,
 * `wo`→`o`, and `e`→`he` when `e` follows a vowel, but never word-initial and
 * never `wa` before a vowel (`kawaii` stays whole). `exactStoredReading` drops
 * only the `e`→`he` alternate when the query is itself a stored reading
 * (いえ/うえ/こえ/まえ), whose final `e` is part of the word, not へ.
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
 * Builds the cleaned query plus its particle alternates: every non-empty
 * subset of eligible substitutions becomes a variant (bitmask over the
 * positions, applied right-to-left, deduplicated, capped at 16), and a
 * whole-query `wa`/`wo`/`e` alternate is marked `exactOnly`. With
 * `options.exactStoredReading` the standalone `e`→`he` alternate is dropped
 * when the query is itself a stored reading (いえ/うえ/こえ/まえ) — without it
 * `ie` would pull いへん (異変) in via the `ihe%` prefix.
 */
export function romajiQueryVariants(
  query: string,
  options: { exactStoredReading?: boolean } = {}
): RomajiQueryVariant[] {
  const cleaned = cleanRomajiQuery(query);
  if (cleaned === '') {
    // Cleaning reduced the query to nothing (e.g. a lone apostrophe), and an
    // empty `%` prefix scan would then match every reading.
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
