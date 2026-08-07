import { dateSchema, type EstimatesResponse } from '@kanjiscribe/shared';
import type { FastifyInstance } from 'fastify';

import { sqlite } from '../db/client.js';
import { parseOr400 } from '../http.js';
import { timeToFinish } from './time-to-finish.js';

export function registerEstimatesRoutes(app: FastifyInstance): void {
  app.get('/estimates/today', async (): Promise<EstimatesResponse> => {
    return { estimated_remaining_ms: timeToFinish(sqlite, { kind: 'today' }) };
  });

  app.get('/estimates/backlog-days', async (): Promise<EstimatesResponse> => {
    return { estimated_remaining_ms: timeToFinish(sqlite, { kind: 'backlog' }) };
  });

  app.get('/estimates/backlog-day', async (request, reply): Promise<EstimatesResponse | undefined> => {
    const date = parseOr400(dateSchema, (request.query as { date?: string }).date, reply, 'Invalid date');
    if (date === null) {
      return;
    }

    return { estimated_remaining_ms: timeToFinish(sqlite, { kind: 'day', date }) };
  });
}
