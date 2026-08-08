import { z } from 'zod';

/**
 * Estimate responses — the time-to-finish surfaces. One shape shared by all
 * three endpoints (`GET /estimates/today`, `/estimates/backlog-days`,
 * `/estimates/backlog-day`).
 */
export const estimatesResponseSchema = z.object({
  // Fractional ms possible: legacy NULL-snapshot rows fall back to a live estimateAssignment (per-stroke coefficient math), unrounded.
  estimated_remaining_ms: z.number()
});

export type EstimatesResponse = z.infer<typeof estimatesResponseSchema>;
