import { describe, expect, it } from 'vitest';

import { interleaveUnfinished, isUnfinishedStatus } from './day-queue.js';

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
