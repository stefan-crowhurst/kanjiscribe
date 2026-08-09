import { useEffect, useState } from 'react';

import { formatMsEstimate, getBacklogDayEstimate, getBacklogDaysEstimate, getTodayEstimate } from '../lib/api.js';

export type EstimateState =
  | { status: 'loading' }
  | { status: 'ready'; value: number }
  | { status: 'error'; message: string };

export function formatEstimateLabel(state: EstimateState): string {
  if (state.status === 'error') {
    return state.message;
  }
  if (state.status === 'ready') {
    return formatMsEstimate(state.value);
  }
  return '—';
}

export function useEstimate(scope: 'today' | 'backlog-days'): EstimateState {
  const [estimate, setEstimate] = useState<EstimateState>({ status: 'loading' });

  useEffect(() => {
    const request = scope === 'today' ? getTodayEstimate() : getBacklogDaysEstimate();
    setEstimate({ status: 'loading' });
    request
      .then((value) => setEstimate({ status: 'ready', value }))
      .catch((err) =>
        setEstimate({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load estimate' })
      );
  }, [scope]);

  return estimate;
}

export function useBacklogDayEstimates(dates: string[]): Record<string, EstimateState> {
  const [estimates, setEstimates] = useState<Record<string, EstimateState>>({});

  useEffect(() => {
    for (const date of dates) {
      setEstimates((current) => ({ ...current, [date]: { status: 'loading' } }));
      getBacklogDayEstimate(date)
        .then((value) => {
          setEstimates((current) => ({ ...current, [date]: { status: 'ready', value } }));
        })
        .catch((err) => {
          setEstimates((current) => ({
            ...current,
            [date]: { status: 'error', message: err instanceof Error ? err.message : 'Failed to load estimate' }
          }));
        });
    }
  }, [dates]);

  return estimates;
}
