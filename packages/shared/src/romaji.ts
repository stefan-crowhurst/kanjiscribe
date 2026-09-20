/**
 * The Romaji form (ADR 0011): a reading's strict Hepburn rendering used for
 * Latin-script search, stored once per reading and kana-literal — long vowels
 * written out (とうきょう → toukyou), ん → `n`, っ doubling the next
 * consonant, ぢ/づ → ji/zu, and を → `o`. Pure and total: unknown characters
 * pass through lowercased, and a reading that reduces to nothing (bare ー, 〜,
 * iteration mark) yields `null`.
 */

import { foldReadingToHiragana } from './reading-fold.js';

const LONG_VOWELS = new Set(['a', 'i', 'u', 'e', 'o']);

/**
 * Characters dropped from the stored form: the middle dot, wave dashes (the
 * full-width tilde U+FF5E that NFKC turns into ASCII `~`, plus U+301C),
 * Japanese commas and stops, and the full-width equals sign (ASCII `=` after
 * NFKC). A mora-separating `=` still converts.
 */
const DROPPED_CHARACTERS = new Set(['・', '〜', '~', '、', '。', '=']);

const SINGLE_KANA: Record<string, string> = {
  あ: 'a',
  い: 'i',
  う: 'u',
  え: 'e',
  お: 'o',
  か: 'ka',
  き: 'ki',
  く: 'ku',
  け: 'ke',
  こ: 'ko',
  が: 'ga',
  ぎ: 'gi',
  ぐ: 'gu',
  げ: 'ge',
  ご: 'go',
  さ: 'sa',
  し: 'shi',
  す: 'su',
  せ: 'se',
  そ: 'so',
  ざ: 'za',
  じ: 'ji',
  ず: 'zu',
  ぜ: 'ze',
  ぞ: 'zo',
  た: 'ta',
  ち: 'chi',
  つ: 'tsu',
  て: 'te',
  と: 'to',
  だ: 'da',
  ぢ: 'ji',
  づ: 'zu',
  で: 'de',
  ど: 'do',
  な: 'na',
  に: 'ni',
  ぬ: 'nu',
  ね: 'ne',
  の: 'no',
  は: 'ha',
  ひ: 'hi',
  ふ: 'fu',
  へ: 'he',
  ほ: 'ho',
  ば: 'ba',
  び: 'bi',
  ぶ: 'bu',
  べ: 'be',
  ぼ: 'bo',
  ぱ: 'pa',
  ぴ: 'pi',
  ぷ: 'pu',
  ぺ: 'pe',
  ぽ: 'po',
  ま: 'ma',
  み: 'mi',
  む: 'mu',
  め: 'me',
  も: 'mo',
  や: 'ya',
  ゆ: 'yu',
  よ: 'yo',
  ら: 'ra',
  り: 'ri',
  る: 'ru',
  れ: 're',
  ろ: 'ro',
  わ: 'wa',
  ゐ: 'i',
  ゑ: 'e',
  を: 'o',
  ん: 'n',
  ゔ: 'vu',
  ぁ: 'a',
  ぃ: 'i',
  ぅ: 'u',
  ぇ: 'e',
  ぉ: 'o',
  ゃ: 'ya',
  ゅ: 'yu',
  ょ: 'yo',
  ゎ: 'wa',
  ゕ: 'ka',
  ゖ: 'ke'
};

const KANA_COMBINATIONS: Record<string, string> = {
  きゃ: 'kya',
  きゅ: 'kyu',
  きょ: 'kyo',
  しゃ: 'sha',
  しゅ: 'shu',
  しょ: 'sho',
  ちゃ: 'cha',
  ちゅ: 'chu',
  ちょ: 'cho',
  にゃ: 'nya',
  にゅ: 'nyu',
  にょ: 'nyo',
  ひゃ: 'hya',
  ひゅ: 'hyu',
  ひょ: 'hyo',
  みゃ: 'mya',
  みゅ: 'myu',
  みょ: 'myo',
  りゃ: 'rya',
  りゅ: 'ryu',
  りょ: 'ryo',
  ぎゃ: 'gya',
  ぎゅ: 'gyu',
  ぎょ: 'gyo',
  じゃ: 'ja',
  じゅ: 'ju',
  じょ: 'jo',
  ぢゃ: 'ja',
  ぢゅ: 'ju',
  ぢょ: 'jo',
  びゃ: 'bya',
  びゅ: 'byu',
  びょ: 'byo',
  ぴゃ: 'pya',
  ぴゅ: 'pyu',
  ぴょ: 'pyo',
  ふぁ: 'fa',
  ふぃ: 'fi',
  ふぇ: 'fe',
  ふぉ: 'fo',
  てぃ: 'ti',
  でぃ: 'di',
  しぇ: 'she',
  じぇ: 'je',
  ちぇ: 'che',
  うぃ: 'wi',
  うぇ: 'we',
  うぉ: 'wo',
  ゔぁ: 'va',
  ゔぃ: 'vi',
  ゔぇ: 've',
  ゔぉ: 'vo'
};

/**
 * Katakana that `foldReadingToHiragana` does not cover: the yōon digraph
 * twins (ヷヸヹヺ are ゔ + small vowel) and the katakana iteration marks.
 */
const KATAKANA_FOLD_OVERRIDES: Record<string, string> = {
  ヷ: 'ゔぁ',
  ヸ: 'ゔぃ',
  ヹ: 'ゔぇ',
  ヺ: 'ゔぉ',
  ヽ: 'ゝ',
  ヾ: 'ゞ'
};

/** Voicing applied to the prior kana when repeating through ゞ or ヾ. */
const VOICED_KANA: Record<string, string> = {
  か: 'が',
  き: 'ぎ',
  く: 'ぐ',
  け: 'げ',
  こ: 'ご',
  さ: 'ざ',
  し: 'じ',
  す: 'ず',
  せ: 'ぜ',
  そ: 'ぞ',
  た: 'だ',
  ち: 'ぢ',
  つ: 'づ',
  て: 'で',
  と: 'ど',
  は: 'ば',
  ひ: 'び',
  ふ: 'ぶ',
  へ: 'べ',
  ほ: 'ぼ'
};

const CONSONANTS = /^[bcdfghjklmnpqrstuvwxyz]$/;

function foldForRomaji(input: string): string {
  let substituted = '';
  for (const char of input) {
    substituted += KATAKANA_FOLD_OVERRIDES[char] ?? char;
  }
  return foldReadingToHiragana(substituted);
}

type Mora = {
  romaji: string;
  length: number;
};

/** The mora starting at `index`, or null when the character is not kana. */
function lookupMora(characters: readonly string[], index: number): Mora | null {
  const first = characters[index];
  if (first === undefined) {
    return null;
  }
  const combination = KANA_COMBINATIONS[first + (characters[index + 1] ?? '')];
  if (combination !== undefined) {
    return { romaji: combination, length: 2 };
  }
  const single = SINGLE_KANA[first];
  if (single !== undefined) {
    return { romaji: single, length: 1 };
  }
  return null;
}

export function toRomajiForm(reading: string): string | null {
  const characters = [...foldForRomaji(reading.normalize('NFKC'))];

  let result = '';
  let previousMoraKana: string | null = null;
  let index = 0;

  while (index < characters.length) {
    const character = characters[index];
    if (character === undefined) {
      break;
    }

    if (DROPPED_CHARACTERS.has(character)) {
      index += 1;
      continue;
    }

    // っ doubles the following mora's onset, but before ch it adds `t` instead
    // (まっちゃ → matcha, not maccha). Before a vowel or at the end it
    // contributes nothing.
    if (character === 'っ') {
      const nextMora = lookupMora(characters, index + 1);
      if (nextMora) {
        if (nextMora.romaji.startsWith('ch')) {
          result += 't';
        } else {
          const onset = nextMora.romaji.charAt(0);
          if (CONSONANTS.test(onset)) {
            result += onset;
          }
        }
      }
      index += 1;
      continue;
    }

    // ー repeats the vowel it follows; after a consonant (or ん) it is silent.
    if (character === 'ー') {
      const lastEmitted = result.charAt(result.length - 1);
      if (LONG_VOWELS.has(lastEmitted)) {
        result += lastEmitted;
      }
      index += 1;
      continue;
    }

    // ゝ/ゞ repeat the prior mora, the voiced form (ゞ) voicing it first. A yōon
    // mora repeats whole (きゃゝ → kyakya, しゃゞ → shaja).
    if (character === 'ゝ' || character === 'ゞ') {
      if (previousMoraKana !== null) {
        const [baseKana, ...restKana] = [...previousMoraKana];
        const voicedBase = character === 'ゞ' ? (VOICED_KANA[baseKana!] ?? baseKana!) : baseKana!;
        const repeated = lookupMora([voicedBase, ...restKana], 0);
        if (repeated !== null) {
          result += repeated.romaji;
        }
      }
      index += 1;
      continue;
    }

    const mora = lookupMora(characters, index);
    if (mora) {
      result += mora.romaji;
      previousMoraKana = characters.slice(index, index + mora.length).join('');
      index += mora.length;
      continue;
    }

    result += character.toLowerCase();
    index += 1;
  }

  return result === '' ? null : result;
}
