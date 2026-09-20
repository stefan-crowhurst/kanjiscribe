import { describe, expect, it } from 'vitest';

import { cleanRomajiQuery, romajiQueryVariants } from './romaji-query.js';

describe('cleanRomajiQuery', () => {
  it('lowercase-folds the query', () => {
    expect(cleanRomajiQuery('TABERU')).toBe('taberu');
    expect(cleanRomajiQuery('Taberu')).toBe('taberu');
  });

  it('strips ASCII and typographic apostrophes', () => {
    expect(cleanRomajiQuery("shin'ichi")).toBe('shinichi');
    expect(cleanRomajiQuery('shin’ichi')).toBe('shinichi');
  });

  it('expands each macron to its literal kana-sequence vowels', () => {
    expect(cleanRomajiQuery('kādo')).toBe('kaado');
    expect(cleanRomajiQuery('kī')).toBe('kii');
    expect(cleanRomajiQuery('yūki')).toBe('yuuki');
    expect(cleanRomajiQuery('sensē')).toBe('sensei');
    expect(cleanRomajiQuery('tōkyō')).toBe('toukyou');
  });

  it('expands uppercase macrons too (lowercased first)', () => {
    expect(cleanRomajiQuery('Tōkyō')).toBe('toukyou');
    expect(cleanRomajiQuery('ĀĪŪĒŌ')).toBe('aaiiuueiou');
  });

  it('combines the rules in one query', () => {
    expect(cleanRomajiQuery("SHIN'ICHI")).toBe('shinichi');
    expect(cleanRomajiQuery('TŌKYŌ')).toBe('toukyou');
  });

  it('passes through an already-clean query unchanged', () => {
    expect(cleanRomajiQuery('taberu')).toBe('taberu');
    expect(cleanRomajiQuery('sushi')).toBe('sushi');
  });
});

describe('romajiQueryVariants', () => {
  it('starts from the cleaned query and adds its particle alternate', () => {
    expect(romajiQueryVariants('KONNICHIWA')).toEqual([
      { value: 'konnichiwa' },
      { value: 'konnichiha' }
    ]);
  });

  it('substitutes every non-initial wa with ha', () => {
    expect(romajiQueryVariants('dewa')).toEqual([{ value: 'dewa' }, { value: 'deha' }]);
    expect(romajiQueryVariants('konbanwa')).toEqual([{ value: 'konbanwa' }, { value: 'konbanha' }]);
  });

  it('substitutes non-initial wo with o (を stores as o)', () => {
    expect(romajiQueryVariants('usowotsuku')).toEqual([
      { value: 'usowotsuku' },
      { value: 'usootsuku' }
    ]);
    // The え after を also gains the e→he alternate, so three subsets all appear.
    expect(romajiQueryVariants('sezaruwoenai')).toEqual([
      { value: 'sezaruwoenai' },
      { value: 'sezaruoenai' },
      { value: 'sezaruwohenai' },
      { value: 'sezaruohenai' }
    ]);
  });

  it('substitutes a standalone non-initial e (after a vowel) with he', () => {
    expect(romajiQueryVariants('dochirae')).toEqual([
      { value: 'dochirae' },
      { value: 'dochirahe' }
    ]);
    expect(romajiQueryVariants('tokoroe')).toEqual([{ value: 'tokoroe' }, { value: 'tokorohe' }]);
    expect(romajiQueryVariants('motoe')).toEqual([{ value: 'motoe' }, { value: 'motohe' }]);
  });

  it('leaves an e that follows a consonant untouched (hone stays 骨, ADR 0011)', () => {
    expect(romajiQueryVariants('hone')).toEqual([{ value: 'hone' }]);
    expect(romajiQueryVariants('taberu')).toEqual([{ value: 'taberu' }]);
  });

  it('combines substitutions: every non-empty subset becomes a variant', () => {
    expect(romajiQueryVariants('dewatokoroe')).toEqual([
      { value: 'dewatokoroe' },
      { value: 'dehatokoroe' },
      { value: 'dewatokorohe' },
      { value: 'dehatokorohe' }
    ]);
  });

  it('never substitutes a word-initial occurrence (wakaru, warau stay clean)', () => {
    expect(romajiQueryVariants('wakaru')).toEqual([{ value: 'wakaru' }]);
    expect(romajiQueryVariants('warau')).toEqual([{ value: 'warau' }]);
  });

  it('leaves a wa that runs into a vowel untouched (kawaii stays whole)', () => {
    expect(romajiQueryVariants('kawaii')).toEqual([{ value: 'kawaii' }]);
  });

  it('still substitutes a medial wa before a consonant (dewanai → dehanai)', () => {
    expect(romajiQueryVariants('dewanai')).toEqual([{ value: 'dewanai' }, { value: 'dehanai' }]);
  });

  it('adds a whole-query wa/wo/e alternate for exact matching only', () => {
    expect(romajiQueryVariants('wa')).toEqual([{ value: 'wa' }, { value: 'ha', exactOnly: true }]);
    expect(romajiQueryVariants('wo')).toEqual([{ value: 'wo' }, { value: 'o', exactOnly: true }]);
    expect(romajiQueryVariants('e')).toEqual([{ value: 'e' }, { value: 'he', exactOnly: true }]);
  });

  it('does not mark embedded alternates exact-only', () => {
    for (const variant of romajiQueryVariants('dewa')) {
      expect(variant.exactOnly).toBeUndefined();
    }
  });

  it('passes non-Latin queries through with no alternates', () => {
    expect(romajiQueryVariants('とうきょう')).toEqual([{ value: 'とうきょう' }]);
    expect(romajiQueryVariants('東京')).toEqual([{ value: '東京' }]);
  });

  it('returns no variants when cleaning reduces the query to nothing', () => {
    // A `%` prefix scan from an empty value would match every reading.
    expect(romajiQueryVariants("'")).toEqual([]);
    expect(romajiQueryVariants('’')).toEqual([]);
  });

  it('caps alternates at 16 so pathological input cannot explode the strategy count', () => {
    const variants = romajiQueryVariants('wawawawawawa');

    expect(variants).toHaveLength(17);
    expect(variants[0]).toEqual({ value: 'wawawawawawa' });
    expect(new Set(variants.map((variant) => variant.value)).size).toBe(17);
  });
});

describe('romajiQueryVariants — exactStoredReading (query is itself a stored reading)', () => {
  it('keeps ie/ue/koe/mae whole, with no e→he alternate', () => {
    for (const query of ['ie', 'ue', 'koe', 'mae'] as const) {
      expect(romajiQueryVariants(query, { exactStoredReading: true }), query).toEqual([
        { value: query }
      ]);
    }
  });

  it('still substitutes wa→ha: dewa must find では even though 出羽 stores dewa', () => {
    expect(romajiQueryVariants('dewa', { exactStoredReading: true })).toEqual([
      { value: 'dewa' },
      { value: 'deha' }
    ]);
  });

  it('still substitutes wo→o but drops the e→he combinations', () => {
    expect(romajiQueryVariants('sezaruwoenai', { exactStoredReading: true })).toEqual([
      { value: 'sezaruwoenai' },
      { value: 'sezaruoenai' }
    ]);
  });

  it('still adds the exact-only whole-query e alternate', () => {
    expect(romajiQueryVariants('e', { exactStoredReading: true })).toEqual([
      { value: 'e' },
      { value: 'he', exactOnly: true }
    ]);
  });
});
