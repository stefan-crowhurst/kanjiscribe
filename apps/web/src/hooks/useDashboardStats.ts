import { useEffect, useRef, useState } from 'react';
import { type DashboardResponse } from '@kanjiscribe/shared';

import { getDashboardStats } from '../lib/api.js';

export function useDashboardStats(
  from: string,
  to: string,
  failureMessage: string
): { data: DashboardResponse | null; error: string | null } {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestedRange = useRef<string | null>(null);

  useEffect(() => {
    const rangeKey = `${from}:${to}`;
    requestedRange.current = rangeKey;
    setData(null);
    setError(null);
    getDashboardStats(from, to)
      .then((res) => {
        if (requestedRange.current === rangeKey) {
          setData(res);
        }
      })
      .catch((err) => {
        if (requestedRange.current === rangeKey) {
          setError(err instanceof Error ? err.message : failureMessage);
        }
      });
  }, [from, to, failureMessage]);

  return { data, error };
}
