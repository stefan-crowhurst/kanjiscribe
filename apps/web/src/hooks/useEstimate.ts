import { useEffect, useState } from 'react';

import { apiRequest } from '../lib/api.js';

type EstimateResponse = {
  estimated_remaining_ms: number;
};

export function useEstimate(endpoint: string): number | null {
  const [estimate, setEstimate] = useState<number | null>(null);

  useEffect(() => {
    apiRequest<EstimateResponse>(endpoint)
      .then((res) => setEstimate(res.estimated_remaining_ms))
      .catch(() => {});
  }, [endpoint]);

  return estimate;
}

export function useBacklogDayEstimates(dates: string[]): Record<string, number> {
  const [estimates, setEstimates] = useState<Record<string, number>>({});

  useEffect(() => {
    for (const date of dates) {
      apiRequest<EstimateResponse>(`/estimates/backlog-day?date=${date}`)
        .then((res) => {
          setEstimates((current) => ({ ...current, [date]: res.estimated_remaining_ms }));
        })
        .catch(() => {});
    }
  }, [dates]);

  return estimates;
}
