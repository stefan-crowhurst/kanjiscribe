import {
  dictionarySearchQuerySchema,
  type DictionaryEntryDetailResponse,
  type DictionarySearchResponse
} from '@kanjiscribe/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { badRequest, notFound, parseIdParam, parseOr400 } from '../http.js';
import { getEntryDetails } from './entries.js';
import { searchDictionary } from './search.js';

export function registerDictionaryRoutes(app: FastifyInstance): void {
  app.get('/dictionary/search', async (request, reply): Promise<DictionarySearchResponse | undefined> => {
    const parsed = parseOr400(dictionarySearchQuerySchema, request.query, reply);
    if (parsed === null) {
      return;
    }

    const results = searchDictionary(parsed.q);
    return { results };
  });

  app.get('/dictionary/entries/:id', async (request, reply): Promise<DictionaryEntryDetailResponse | FastifyReply | undefined> => {
    const id = parseIdParam(request.params);
    if (id === null) {
      return badRequest(reply, 'Invalid entry id');
    }

    const entry = getEntryDetails(id);
    if (!entry) {
      return notFound(reply, 'Dictionary entry not found');
    }

    return { entry };
  });
}
