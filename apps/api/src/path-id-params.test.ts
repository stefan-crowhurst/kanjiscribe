import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { resetCounters, resetDb } from './test-helpers.js';

type IdRoute = {
  name: string;
  method: 'GET' | 'POST';
  url: (id: string) => string;
  message: string;
};

/**
 * Every route that takes a path-parameter id (ADR-0006): assignment drill,
 * view, complete, skip, reopen, archive, unarchive; dictionary entry detail;
 * study-item stats. Each keeps its own 400 message.
 */
const idRoutes: IdRoute[] = [
  { name: 'assignment drill', method: 'GET', url: (id) => `/assignments/${id}/drill`, message: 'Invalid assignment id' },
  { name: 'assignment view', method: 'GET', url: (id) => `/assignments/${id}/view`, message: 'Invalid assignment id' },
  { name: 'assignment complete', method: 'POST', url: (id) => `/assignments/${id}/complete`, message: 'Invalid assignment id' },
  { name: 'assignment skip', method: 'POST', url: (id) => `/assignments/${id}/skip`, message: 'Invalid assignment id' },
  { name: 'assignment reopen', method: 'POST', url: (id) => `/assignments/${id}/reopen`, message: 'Invalid assignment id' },
  { name: 'assignment archive', method: 'POST', url: (id) => `/assignments/${id}/archive`, message: 'Invalid assignment id' },
  { name: 'assignment unarchive', method: 'POST', url: (id) => `/assignments/${id}/unarchive`, message: 'Invalid assignment id' },
  { name: 'dictionary entry detail', method: 'GET', url: (id) => `/dictionary/entries/${id}`, message: 'Invalid entry id' },
  { name: 'study-item stats', method: 'GET', url: (id) => `/stats/study-items/${id}`, message: 'Invalid study item id' }
];

const badIds = [
  { name: 'missing', id: '' },
  { name: 'non-numeric', id: 'not-an-id' },
  { name: 'non-integer', id: '3.14' },
  { name: 'non-positive', id: '0' }
];

describe('path-param ids are rejected before any database work on every id-taking route', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  for (const route of idRoutes) {
    for (const bad of badIds) {
      it(`rejects a ${bad.name} id on ${route.name} with 400 and the route's message`, async () => {
        const res = await app.inject({ method: route.method, url: route.url(bad.id) });

        expect(res.statusCode).toBe(400);
        expect(JSON.parse(res.body)).toEqual({ error: route.message });
      });
    }
  }
});
