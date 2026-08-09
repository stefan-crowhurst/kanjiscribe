import { z } from 'zod';

/**
 * Error response body — the shape every non-2xx api response sends
 * (`{ error: string }`), produced by the api's `badRequest`/`notFound`/
 * `conflict` helpers and its error handler. The web's `apiRequest` parses
 * error bodies through this schema at its client seam (ADR-0006) instead of
 * a hand cast; a body that fails the schema falls back to the generic
 * status message, so the message users see for the api's real error bodies
 * is unchanged.
 */
export const errorResponseSchema = z.object({
  error: z.string()
});

export type ErrorResponse = z.infer<typeof errorResponseSchema>;
