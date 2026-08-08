import { describe, expect, it } from 'vitest';

import { safeJsonParse } from './util.js';

describe('safeJsonParse', () => {
  it('returns an empty array for null', () => {
    expect(safeJsonParse<string[]>(null)).toEqual([]);
  });

  it('returns an empty array for invalid JSON', () => {
    expect(safeJsonParse<string[]>('not json')).toEqual([]);
  });

  it('parses valid JSON', () => {
    expect(safeJsonParse<string[]>('["surface","読み"]')).toEqual(['surface', '読み']);
  });
});
