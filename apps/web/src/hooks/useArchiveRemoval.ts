import { useCallback } from 'react';
import type { Assignment } from '@kanjiscribe/shared';

import { archiveAssignment } from '../lib/api.js';

export function useArchiveRemoval(
  refresh: () => Promise<void>,
  setError: (message: string | null) => void
) {
  const handleRemove = useCallback(
    async (assignment: Assignment) => {
      try {
        await archiveAssignment(assignment.id);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove assignment');
      }
    },
    [refresh, setError]
  );

  return handleRemove;
}
