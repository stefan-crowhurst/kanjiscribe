import { useEffect, useState } from 'react';

import { getBacklogDayEstimate, getBacklogDaysEstimate, getTodayEstimate } from '../lib/api.js';

export function useEstimate(scope: 'today' | 'backlog-days'): number | null {
  const [estimate, setEstimate] = useState<number | null>(null);

  useEffect(() => {
    const request = scope === 'today' ? getTodayEstimate() : getBacklogDaysEstimate();
    request.then(setEstimate).catch(() => {});
  }, [scope]);

  return estimate;
}

export function useBacklogDayEstimates(dates: string[]): Record<string, number> {
  const [estimates, setEstimates] = useState<Record<string, number>>({});

  useEffect(() => {
    for (const date of dates) {
      getBacklogDayEstimate(date)
        .then((estimate) => {
          setEstimates((current) => ({ ...current, [date]: estimate }));
        })
        .catch(() => {});
    }
  }, [dates]);

  return estimates;
}
