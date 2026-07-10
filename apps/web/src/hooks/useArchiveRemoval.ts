import { useCallback } from 'react';

import { archiveAssignment } from '../lib/api.js';

type RemovableAssignment = {
  id: number;
};

export function useArchiveRemoval(
  refresh: () => Promise<void>,
  setError: (message: string | null) => void
) {
  const handleRemove = useCallback(
    async (assignment: RemovableAssignment) => {
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
