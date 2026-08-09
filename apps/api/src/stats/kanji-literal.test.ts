import { beforeEach, describe, expect, it } from 'vitest';

import { app } from '../server.js';
import { resetCounters, resetDb, seedKanji } from '../test-helpers.js';

/**
 * Kanji-literal path-param validation (zod-validation-sweep PRD): the
 * `/stats/kanji/:literal` route percent-decodes then validates through the
 * shared kanji-literal schema, so a malformed literal returns a clear 400
 * before any database work instead of a confusing 404. Tested at the HTTP
 * seam; the schema under test is the same object the web's client seam uses.
 */
describe('stats/kanji/:literal path-param validation', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
    seedKanji('永', 5);
  });

  it('resolves a percent-encoded valid literal exactly as before', async () => {
    const res = await app.inject({ method: 'GET', url: `/stats/kanji/${encodeURIComponent('永')}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().kanji.literal).toBe('永');
  });

  it('rejects an empty literal with a 400 and a clear message', async () => {
    const res = await app.inject({ method: 'GET', url: '/stats/kanji/' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid kanji literal' });
  });

  it('rejects a multi-character literal with a 400 and a clear message', async () => {
    const res = await app.inject({ method: 'GET', url: `/stats/kanji/${encodeURIComponent('永日')}` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid kanji literal' });
  });

  it('rejects a non-kanji literal with a 400 and a clear message', async () => {
    const res = await app.inject({ method: 'GET', url: `/stats/kanji/${encodeURIComponent('あ')}` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid kanji literal' });
  });

  it('rejects a percent-encoded invalid literal with a 400 and a clear message', async () => {
    // Decodes to 永 + NUL — a valid kanji glued to a non-kanji character
    // that only exists in the URL via percent-encoding.
    const res = await app.inject({ method: 'GET', url: `/stats/kanji/${encodeURIComponent('永\u0000')}` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'Invalid kanji literal' });
  });

  it('accepts a CJK Extension-A literal and falls through to the not-found path', async () => {
    // U+3400 (㐀) is inside the Extension-A range the schema shares with the
    // intake check: it validates, then misses the kanji table.
    const res = await app.inject({ method: 'GET', url: `/stats/kanji/${encodeURIComponent('\u3400')}` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'Kanji not found' });
  });
});
