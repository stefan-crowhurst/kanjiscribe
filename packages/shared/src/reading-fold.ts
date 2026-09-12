/**
 * Reading identity ignores kana script (ADR 0010). A reading is defined by
 * its per-character katakana→hiragana fold; the stored text is always the
 * kept form's own text, never a rewritten string.
 *
 * The katakana block U+30A1–U+30F6 (including small kana and ヴ) maps
 * linearly onto hiragana U+3041–U+3096 by subtracting 0x60; the reverse
 * maps hiragana back by adding 0x60. Characters outside those blocks — the
 * prolonged-sound mark ー (U+30FC), the middle dot ・ (U+30FB), Latin,
 * digits — pass through unchanged in both directions.
 */

/**
 * The identity fold: katakana text written as hiragana. Two readings share
 * an identity when their folds are equal; the fold never rewrites stored
 * text, it only defines identity.
 */
export function foldReadingToHiragana(reading: string): string {
  let folded = '';
  for (const char of reading) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint >= 0x30a1 && codePoint <= 0x30f6) {
      folded += String.fromCodePoint(codePoint - 0x60);
    } else {
      folded += char;
    }
  }
  return folded;
}

/**
 * The reverse fold: hiragana text written as katakana. Used to match a
 * hiragana query against katakana-stored readings.
 */
export function foldReadingToKatakana(reading: string): string {
  let folded = '';
  for (const char of reading) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint >= 0x3041 && codePoint <= 0x3096) {
      folded += String.fromCodePoint(codePoint + 0x60);
    } else {
      folded += char;
    }
  }
  return folded;
}

function isHiraganaOnly(reading: string): boolean {
  for (const char of reading) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint >= 0x30a1 && codePoint <= 0x30f6) {
      return false;
    }
  }
  return true;
}

/**
 * The per-entry collapse decision (ADR 0010): group the entry's readings by
 * folded identity, keep exactly one survivor per group — the hiragana form
 * when the group has one, otherwise the first form's own text — and emit the
 * survivors in the dictionary order of their groups. Groups are independent:
 * a script pair never merges with an unrelated reading, and phonetic
 * near-misses are character differences, not script differences, so they
 * always survive separately.
 */
export function collapseEntryReadings(readings: readonly string[]): string[] {
  const groupOrder: string[] = [];
  const survivorByFold = new Map<string, string>();

  for (const reading of readings) {
    const identity = foldReadingToHiragana(reading);
    const existing = survivorByFold.get(identity);
    if (existing === undefined) {
      survivorByFold.set(identity, reading);
      groupOrder.push(reading);
      continue;
    }
    if (!isHiraganaOnly(existing) && isHiraganaOnly(reading)) {
      survivorByFold.set(identity, reading);
      groupOrder[groupOrder.indexOf(existing)] = reading;
    }
  }

  return groupOrder;
}