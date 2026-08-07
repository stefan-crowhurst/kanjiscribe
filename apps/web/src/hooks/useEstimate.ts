import { useEffect, useState } from 'react';

import { estimatesResponseSchema } from '@kanjiscribe/shared';

import { apiRequest } from '../lib/api.js';

export function useEstimate(endpoint: string): number | null {
  const [estimate, setEstimate] = useState<number | null>(null);

  useEffect(() => {
    apiRequest(estimatesResponseSchema, endpoint)
      .then((res) => setEstimate(res.estimated_remaining_ms))
      .catch(() => {});
  }, [endpoint]);

  return estimate;
}

export function useBacklogDayEstimates(dates: string[]): Record<string, number> {
  const [estimates, setEstimates] = useState<Record<string, number>>({});

  useEffect(() => {
    for (const date of dates) {
      apiRequest(estimatesResponseSchema, `/estimates/backlog-day?date=${date}`)
        .then((res) => {
          setEstimates((current) => ({ ...current, [date]: res.estimated_remaining_ms }));
        })
        .catch(() => {});
    }
  }, [dates]);

  return estimates;
}
