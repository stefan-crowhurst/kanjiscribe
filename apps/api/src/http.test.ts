import { describe, expect, it } from 'vitest';

import { parseIdParam, safeJsonParse } from './http.js';

describe('parseIdParam', () => {
  it('returns the id for a valid numeric string', () => {
    expect(parseIdParam({ id: '42' })).toBe(42);
  });

  it('returns null for a non-integer id', () => {
    expect(parseIdParam({ id: '3.14' })).toBeNull();
  });

  it('returns null for a zero or negative id', () => {
    expect(parseIdParam({ id: '0' })).toBeNull();
    expect(parseIdParam({ id: '-5' })).toBeNull();
  });

  it('returns null for a non-numeric id', () => {
    expect(parseIdParam({ id: 'abc' })).toBeNull();
  });
});

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
