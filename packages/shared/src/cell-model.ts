export type KanjiInfo = {
  position: number;
  stroke_count: number;
};

export type PerWriteTime = {
  position: number;
  per_write_time_ms: number;
};

export type CellModelResult = {
  per_char_writes: Map<number, number>;
  kana_writes_total: number;
};

function kanaRunCells(runLength: number): number {
  return Math.ceil(runLength / 2);
}

/**
 * Compute how many times each surface character is written across the 10-cell
 * drilling layout, plus the total number of kana writes (surface kana plus the
 * reading-writing first-copy pass).
 *
 * @param surface_form - The word as it appears on the card.
 * @param kanji - Kanji characters in the surface form with their positions and
 *   stroke counts.
 * @param selected_reading - The reading written out during the first clean copy.
 * @param per_write_times - Optional known per-write times for individual kanji.
 *   When empty, remainder-fill tie-breaks fall back to stroke count.
 */
export function computeCellWrites(
  surface_form: string,
  kanji: KanjiInfo[],
  selected_reading: string,
  per_write_times: PerWriteTime[] = []
): CellModelResult {
  const chars = Array.from(surface_form);
  const kanjiByPosition = new Map<number, KanjiInfo>();
  for (const k of kanji) {
    kanjiByPosition.set(k.position, k);
  }

  // 1. Compute cell cost: one cell per kanji, and adjacent kana units pair
  // into cells of at most two.
  let cellsPerCopy = 0;
  let kanaRunLength = 0;
  for (let i = 0; i < chars.length; i++) {
    if (kanjiByPosition.has(i)) {
      if (kanaRunLength > 0) {
        cellsPerCopy += kanaRunCells(kanaRunLength);
        kanaRunLength = 0;
      }
      cellsPerCopy += 1;
    } else {
      kanaRunLength += 1;
    }
  }
  if (kanaRunLength > 0) {
    cellsPerCopy += kanaRunCells(kanaRunLength);
  }

  // 2. Number of full clean copies and leftover remainder cells.
  const fullCopies = Math.floor(10 / cellsPerCopy);
  const remainderCells = 10 - fullCopies * cellsPerCopy;

  // 3. Every surface character is written N times during the clean copies.
  const writesByPosition = new Map<number, number>();
  for (let i = 0; i < chars.length; i++) {
    writesByPosition.set(i, fullCopies);
  }

  function incrementWrites(position: number): void {
    writesByPosition.set(position, (writesByPosition.get(position) ?? 0) + 1);
  }

  // 4. Fill remainder cells with highest-write-time-first characters.
  if (remainderCells > 0) {
    const perWriteTimeByPosition = new Map<number, number>();
    for (const pwt of per_write_times) {
      perWriteTimeByPosition.set(pwt.position, pwt.per_write_time_ms);
    }

    const sortedKanji = [...kanji].sort((a, b) => {
      const keyA = perWriteTimeByPosition.get(a.position) ?? a.stroke_count;
      const keyB = perWriteTimeByPosition.get(b.position) ?? b.stroke_count;
      if (keyA !== keyB) return keyB - keyA;
      return a.position - b.position;
    });

    const kanaPositions: number[] = [];
    for (let i = 0; i < chars.length; i++) {
      if (!kanjiByPosition.has(i)) {
        kanaPositions.push(i);
      }
    }

    let kanaRemainderSlot = 0;
    for (let cell = 0; cell < remainderCells; cell++) {
      if (sortedKanji.length > 0) {
        // Kanji fill remainder cells one per cell, cycling through the sorted
        // list so the highest-write-time kanji can occupy multiple cells.
        const k = sortedKanji[cell % sortedKanji.length]!;
        incrementWrites(k.position);
      } else {
        // Kana-only words fill remainder cells with kana units at two per cell.
        for (let slot = 0; slot < 2; slot++) {
          if (kanaPositions.length === 0) break;
          const pos = kanaPositions[kanaRemainderSlot % kanaPositions.length]!;
          incrementWrites(pos);
          kanaRemainderSlot += 1;
        }
      }
    }
  }

  // 5. Reading-writing first-copy addition: the selected reading is written
  // once in kana alongside the surface form.
  let surfaceKanaWrites = 0;
  for (let i = 0; i < chars.length; i++) {
    if (!kanjiByPosition.has(i)) {
      surfaceKanaWrites += writesByPosition.get(i) ?? 0;
    }
  }
  const kana_writes_total = surfaceKanaWrites + Array.from(selected_reading).length;

  return { per_char_writes: writesByPosition, kana_writes_total };
}
