import { beforeEach, describe, expect, it } from 'vitest';

import { intakeRequestSchema } from '@kanjiscribe/shared';

import { app } from './server.js';
import { resetCounters, resetDb } from './test-helpers.js';

/**
 * Parse-or-400 contract (ADR-0006): a failed request parse yields 400 with
 * `{ error }` carrying a human-readable message drawn from the FIRST zod
 * issue — not a generic fallback. Existing route tests pin the status code
 * and the route-supplied messages; this pins the message source against the
 * validation library's issue shape, so a library major that reshapes issues
 * cannot silently degrade the 400 body to 'Invalid request'.
 */
describe('parse-or-400 draws its message from the first zod issue', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('returns the first issue message of a multi-issue request body', async () => {
    // An empty intake body fails on surface_form, selected_reading and
    // dictionary_entry_id — three issues in schema order. The 400 must carry
    // the first one (surface_form), proving "first issue" and not just "some
    // non-empty string".
    const expected = intakeRequestSchema.safeParse({});
    expect(expected.success).toBe(false);
    if (expected.success) {
      return;
    }
    const firstIssueMessage = expected.error.issues[0]?.message;
    expect(firstIssueMessage).toBeTypeOf('string');

    const res = await app.inject({
      method: 'POST',
      url: '/study-items/intake',
      payload: {}
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: firstIssueMessage });
    expect(res.json().error).not.toBe('Invalid request');
  });
});
