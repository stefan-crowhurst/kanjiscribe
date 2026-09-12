import { describe, expect, it } from 'vitest';

import { collapseEntryReadings, foldReadingToHiragana, foldReadingToKatakana } from './reading-fold.js';

describe('foldReadingToHiragana', () => {
  it('maps every katakana character to its hiragana twin', () => {
    expect(foldReadingToHiragana('アッサリ')).toBe('あっさり');
    expect(foldReadingToHiragana('ダンス')).toBe('だんす');
    expect(foldReadingToHiragana('コーヒー')).toBe('こーひー');
  });

  it('maps the full small-kana block including ヵ and ヶ', () => {
    expect(foldReadingToHiragana('ァィゥェォヵヶ')).toBe('ぁぃぅぇぉゕゖ');
  });

  it('maps ヴ to ゔ', () => {
    expect(foldReadingToHiragana('ヴァイオリン')).toBe('ゔぁいおりん');
  });

  it('passes the prolonged-sound mark and middle dot through unchanged', () => {
    expect(foldReadingToHiragana('ー・')).toBe('ー・');
  });

  it('leaves hiragana and non-kana text untouched', () => {
    expect(foldReadingToHiragana('あっさり')).toBe('あっさり');
    expect(foldReadingToHiragana('ABC123')).toBe('ABC123');
  });

  it('returns an empty string for an empty reading', () => {
    expect(foldReadingToHiragana('')).toBe('');
  });
});

describe('foldReadingToKatakana', () => {
  it('maps every hiragana character to its katakana twin', () => {
    expect(foldReadingToKatakana('だんす')).toBe('ダンス');
    expect(foldReadingToKatakana('こーひー')).toBe('コーヒー');
  });

  it('maps the full small-kana block including ゕ and ゖ, and ゔ to ヴ', () => {
    expect(foldReadingToKatakana('ぁぃぅぇぉゕゖゔ')).toBe('ァィゥェォヵヶヴ');
  });

  it('passes the prolonged-sound mark and middle dot through unchanged', () => {
    expect(foldReadingToKatakana('ー・')).toBe('ー・');
  });

  it('leaves katakana and non-kana text untouched', () => {
    expect(foldReadingToKatakana('アッサリ')).toBe('アッサリ');
    expect(foldReadingToKatakana('ABC123')).toBe('ABC123');
  });
});

describe('collapseEntryReadings', () => {
  it('collapses a hiragana/katakana script pair onto the hiragana form', () => {
    expect(collapseEntryReadings(['あっさり', 'アッサリ'])).toEqual(['あっさり']);
  });

  it('collapses a katakana-first pair onto the hiragana form, in dictionary position of the pair', () => {
    expect(collapseEntryReadings(['アッサリ', 'あっさり'])).toEqual(['あっさり']);
  });

  it('keeps gairaigo with no hiragana twin untouched', () => {
    expect(collapseEntryReadings(['ダンス'])).toEqual(['ダンス']);
    expect(collapseEntryReadings(['コーヒー'])).toEqual(['コーヒー']);
  });

  it('keeps a script pair plus an unrelated third reading as two readings', () => {
    expect(collapseEntryReadings(['アッサリ', 'あっさり', 'ぜんぶ'])).toEqual(['あっさり', 'ぜんぶ']);
  });

  it('collapses two independent script pairs separately, each to hiragana', () => {
    expect(collapseEntryReadings(['カチカチ', 'コチコチ', 'かちかち', 'こちこち'])).toEqual([
      'かちかち',
      'こちこち'
    ]);
  });

  it('keeps a mixed-script reading without a hiragana twin in its original written form', () => {
    expect(collapseEntryReadings(['バカな'])).toEqual(['バカな']);
  });

  it('prefers the hiragana form over a mixed-script variant of the same identity', () => {
    expect(collapseEntryReadings(['バカな', 'ばかな'])).toEqual(['ばかな']);
  });

  it('folds ヴ to ゔ for identity, keeping the hiragana twin', () => {
    expect(collapseEntryReadings(['ヴァン', 'ゔぁん'])).toEqual(['ゔぁん']);
  });

  it('keeps phonetic near-misses distinct', () => {
    expect(collapseEntryReadings(['あかん', 'あかーん'])).toEqual(['あかん', 'あかーん']);
    expect(collapseEntryReadings(['カチカチ', 'カッチカチ'])).toEqual(['カチカチ', 'カッチカチ']);
  });

  it('keeps survivors in dictionary order of their groups', () => {
    expect(collapseEntryReadings(['アッサリ', 'ぜんぶ', 'あっさり'])).toEqual(['あっさり', 'ぜんぶ']);
  });

  it('returns an empty list for no readings', () => {
    expect(collapseEntryReadings([])).toEqual([]);
  });
});