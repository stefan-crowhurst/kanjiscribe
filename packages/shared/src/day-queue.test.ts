import { describe, expect, it } from 'vitest';

import { interleaveUnfinished, isUnfinishedStatus, reorderOnDrop } from './day-queue.js';

type Row = { id: number; status: 'pending' | 'completed' | 'skipped' | 'archived' };

const row = (id: number, status: Row['status']): Row => ({ id, status });

describe('isUnfinishedStatus', () => {
  it('treats pending and skipped as the day’s reorderable work', () => {
    expect(isUnfinishedStatus('pending')).toBe(true);
    expect(isUnfinishedStatus('skipped')).toBe(true);
    expect(isUnfinishedStatus('completed')).toBe(false);
    expect(isUnfinishedStatus('archived')).toBe(false);
  });
});

describe('interleaveUnfinished', () => {
  it('keeps an arrangement of only-unfinished rows', () => {
    const items = [row(1, 'pending'), row(2, 'pending'), row(3, 'skipped')];
    expect(
      interleaveUnfinished(items, [row(3, 'skipped'), row(1, 'pending'), row(2, 'pending')])
    ).toEqual([row(3, 'skipped'), row(1, 'pending'), row(2, 'pending')]);
  });

  it('moves unfinished rows across a completed anchor', () => {
    const items = [row(1, 'pending'), row(9, 'completed'), row(2, 'pending')];
    expect(interleaveUnfinished(items, [row(2, 'pending'), row(1, 'pending')])).toEqual([
      row(2, 'pending'),
      row(9, 'completed'),
      row(1, 'pending')
    ]);
  });

  it('holds completed anchors at their exact slots across interleaved arrangements', () => {
    const items = [
      row(1, 'pending'),
      row(9, 'completed'),
      row(2, 'pending'),
      row(10, 'completed'),
      row(3, 'skipped')
    ];
    expect(
      interleaveUnfinished(items, [row(3, 'skipped'), row(2, 'pending'), row(1, 'pending')])
    ).toEqual([
      row(3, 'skipped'),
      row(9, 'completed'),
      row(2, 'pending'),
      row(10, 'completed'),
      row(1, 'pending')
    ]);
  });

  it('does not touch rows that are not unfinished', () => {
    const items = [row(1, 'archived'), row(2, 'pending'), row(3, 'completed')];
    expect(interleaveUnfinished(items, [row(2, 'pending')])).toEqual([
      row(1, 'archived'),
      row(2, 'pending'),
      row(3, 'completed')
    ]);
  });
});

describe('reorderOnDrop', () => {
  it('moves an unfinished row onto another unfinished row', () => {
    const items = [row(1, 'pending'), row(2, 'pending'), row(3, 'pending')];
    expect(reorderOnDrop(items, 1, 3)).toEqual([row(2, 'pending'), row(3, 'pending'), row(1, 'pending')]);
  });

  it('drops a row dragged down from above onto a completed anchor below it', () => {
    const items = [row(1, 'pending'), row(2, 'pending'), row(9, 'completed')];
    expect(reorderOnDrop(items, 1, 9)).toEqual([row(2, 'pending'), row(1, 'pending'), row(9, 'completed')]);
  });

  it('drops a row dragged up from below onto a completed anchor above it', () => {
    const items = [row(1, 'pending'), row(9, 'completed'), row(2, 'pending')];
    expect(reorderOnDrop(items, 2, 9)).toEqual([row(2, 'pending'), row(9, 'completed'), row(1, 'pending')]);
  });

  it('clamps to the top unfinished slot when an anchor has no slot above it', () => {
    const items = [row(9, 'completed'), row(1, 'pending'), row(2, 'pending')];
    expect(reorderOnDrop(items, 2, 9)).toEqual([row(9, 'completed'), row(2, 'pending'), row(1, 'pending')]);
  });

  it('reorders around interleaved completed anchors', () => {
    const items = [
      row(1, 'pending'),
      row(9, 'completed'),
      row(2, 'pending'),
      row(10, 'completed'),
      row(3, 'pending')
    ];
    expect(reorderOnDrop(items, 1, 10)).toEqual([
      row(2, 'pending'),
      row(9, 'completed'),
      row(3, 'pending'),
      row(10, 'completed'),
      row(1, 'pending')
    ]);
  });

  it('returns null when a completed row is dropped', () => {
    const items = [row(1, 'pending'), row(9, 'completed')];
    expect(reorderOnDrop(items, 9, 1)).toBeNull();
  });

  it('returns null for a no-op drop onto the same unfinished slot', () => {
    const items = [row(1, 'pending'), row(2, 'pending')];
    expect(reorderOnDrop(items, 1, 1)).toBeNull();
  });

  it('returns null for unknown ids', () => {
    const items = [row(1, 'pending'), row(2, 'pending')];
    expect(reorderOnDrop(items, 1, 99)).toBeNull();
    expect(reorderOnDrop(items, 99, 1)).toBeNull();
  });
});
