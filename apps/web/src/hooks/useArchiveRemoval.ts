import { useCallback, useState } from 'react';
import type { Assignment } from '@kanjiscribe/shared';

import { archiveAssignment } from '../lib/api.js';

export function useArchiveRemoval(
  refresh: () => Promise<void>,
  setError: (message: string | null) => void
): { handleRemove: (assignment: Assignment) => void; removingId: number | null } {
  const [removingId, setRemovingId] = useState<number | null>(null);

  const handleRemove = useCallback(
    async (assignment: Assignment) => {
      setRemovingId(assignment.id);
      try {
        await archiveAssignment(assignment.id);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove assignment');
      } finally {
        setRemovingId(null);
      }
    },
    [refresh, setError]
  );

  return { handleRemove, removingId };
}
