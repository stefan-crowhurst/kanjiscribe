import { describe, expect, it } from 'vitest';

import { computeCellWrites } from './cell-model.js';

describe('computeCellWrites', () => {
  it('is pure: repeated calls with the same inputs return identical results', () => {
    const input = {
      surface_form: '迫る',
      kanji: [{ position: 0, stroke_count: 8 }],
      selected_reading: 'せまる'
    };

    const first = computeCellWrites(input.surface_form, input.kanji, input.selected_reading);
    const second = computeCellWrites(input.surface_form, input.kanji, input.selected_reading);

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });

  it('single-kanji word with kana writes the kanji and kana 5 times each and counts reading-writing kana', () => {
    const { per_char_writes, kana_writes_total } = computeCellWrites(
      '迫る',
      [{ position: 0, stroke_count: 8 }],
      'せまる'
    );

    expect(Object.fromEntries(per_char_writes)).toEqual({
      0: 5,
      1: 5
    });
    expect(kana_writes_total).toBe(5 + 3);
  });

  it('kana-only word writes each kana N times and packs remainder kana two per cell', () => {
    const { per_char_writes, kana_writes_total } = computeCellWrites(
      'ありがとう',
      [],
      'ありがとう'
    );

    // 5 kana -> 3 cells per copy -> N = 3, remainder = 1 cell = 2 extra kana writes.
    expect(Object.fromEntries(per_char_writes)).toEqual({
      0: 4,
      1: 4,
      2: 3,
      3: 3,
      4: 3
    });
    expect(kana_writes_total).toBe(17 + 5);
  });

  it('single kanji with no kana writes the kanji 10 times and only counts reading-writing kana', () => {
    const { per_char_writes, kana_writes_total } = computeCellWrites(
      '山',
      [{ position: 0, stroke_count: 3 }],
      'やま'
    );

    expect(Object.fromEntries(per_char_writes)).toEqual({
      0: 10
    });
    expect(kana_writes_total).toBe(2);
  });

  it('cell_cost > 10 sets N = 0 and fills all 10 cells by stroke count, repeating as needed', () => {
    // 11 kanji -> cell_cost = 11 -> N = 0, remainder = 10.
    const surface = '一二三四五六七八九十土';
    const kanji = Array.from(surface).map((_, position) => ({
      position,
      stroke_count: position === 10 ? 3 : 1
    }));

    const { per_char_writes, kana_writes_total } = computeCellWrites(surface, kanji, 'よみ');

    // Highest stroke count first (position 10), then leftmost ties.
    // With only 10 remainder cells, one of the 11 kanji is left out.
    const writes = Object.fromEntries(per_char_writes);
    expect(writes[10]).toBe(1);

    const writtenOnce = Object.values(writes).filter((count) => count === 1).length;
    expect(writtenOnce).toBe(10);

    const zeroCount = Object.values(writes).filter((count) => count === 0).length;
    expect(zeroCount).toBe(1);

    expect(kana_writes_total).toBe(2);
  });

  it('cell_cost > 10 with few kanji repeats kanji to fill all 10 cells', () => {
    // 3 kanji + 18 kana -> cell_cost = 12 -> N = 0, remainder = 10.
    const surface = 'abc'.repeat(6);
    const kanji = [
      { position: 0, stroke_count: 10 },
      { position: 1, stroke_count: 5 },
      { position: 2, stroke_count: 3 }
    ];

    const { per_char_writes } = computeCellWrites(surface, kanji, 'よみ');

    const writes = Object.fromEntries(per_char_writes);
    // Sorted by stroke count: 0, 1, 2; cycle through them for 10 cells.
    expect(writes[0]).toBe(4);
    expect(writes[1]).toBe(3);
    expect(writes[2]).toBe(3);
  });

  it('multi-kanji remainder uses highest stroke count when no per-write times are known', () => {
    // 2 kanji + 2 kana -> cell_cost = 3 -> N = 3, remainder = 1.
    const { per_char_writes } = computeCellWrites(
      '高い山',
      [
        { position: 0, stroke_count: 10 },
        { position: 2, stroke_count: 3 }
      ],
      'たかいやま'
    );

    const writes = Object.fromEntries(per_char_writes);
    expect(writes[0]).toBe(4); // 高 gets the remainder cell
    expect(writes[2]).toBe(3);
  });

  it('multi-kanji remainder tie-break uses longest known per-write time first', () => {
    // 2 kanji + 2 kana -> cell_cost = 3 -> N = 3, remainder = 1.
    const { per_char_writes } = computeCellWrites(
      '高い山',
      [
        { position: 0, stroke_count: 10 },
        { position: 2, stroke_count: 3 }
      ],
      'たかいやま',
      [
        { position: 2, per_write_time_ms: 5000 },
        { position: 0, per_write_time_ms: 2000 }
      ]
    );

    const writes = Object.fromEntries(per_char_writes);
    expect(writes[2]).toBe(4); // 山 has the longer known time
    expect(writes[0]).toBe(3);
  });

  it('ties at equal stroke count go to the leftmost kanji', () => {
    const { per_char_writes } = computeCellWrites(
      '高い山',
      [
        { position: 0, stroke_count: 5 },
        { position: 2, stroke_count: 5 }
      ],
      'たかいやま'
    );

    const writes = Object.fromEntries(per_char_writes);
    expect(writes[0]).toBe(4);
    expect(writes[2]).toBe(3);
  });

  it('single kanji can fill multiple remainder cells by repetition', () => {
    // 1 kanji + 5 kana -> cell_cost = 4 -> N = 2, remainder = 2 cells.
    // Both remainder cells go to the single kanji.
    const { per_char_writes } = computeCellWrites(
      '山ありがとう',
      [{ position: 0, stroke_count: 3 }],
      'やまありがとう'
    );

    const writes = Object.fromEntries(per_char_writes);
    expect(writes[0]).toBe(4);
    for (let i = 1; i <= 5; i++) {
      expect(writes[i]).toBe(2);
    }
  });

  it('kana-only remainder distributes two kana writes per remainder cell', () => {
    // 7 kana -> cell_cost = 4 -> N = 2, remainder = 2 cells = 4 extra writes.
    const { per_char_writes, kana_writes_total } = computeCellWrites(
      'あいうえおかき',
      [],
      'あいうえおかき'
    );

    expect(Object.fromEntries(per_char_writes)).toEqual({
      0: 3,
      1: 3,
      2: 3,
      3: 3,
      4: 2,
      5: 2,
      6: 2
    });
    expect(kana_writes_total).toBe(18 + 7);
  });

  it('treats Latin, digits and punctuation as kana units that pair into cells', () => {
    const { per_char_writes, kana_writes_total } = computeCellWrites(
      'A1!',
      [],
      'abc'
    );

    // 3 kana units -> 2 cells -> N = 5, remainder = 0.
    expect(Object.fromEntries(per_char_writes)).toEqual({
      0: 5,
      1: 5,
      2: 5
    });
    expect(kana_writes_total).toBe(15 + 3);
  });

  it('reading-writing addition is applied exactly once, not per clean copy', () => {
    // Single kanji -> 10 clean copies.
    const shortReading = computeCellWrites('山', [{ position: 0, stroke_count: 3 }], 'や');
    expect(shortReading.kana_writes_total).toBe(1);

    // Long reading still adds once.
    const longReading = computeCellWrites('山', [{ position: 0, stroke_count: 3 }], 'やまがた');
    expect(longReading.kana_writes_total).toBe(4);
  });
});
