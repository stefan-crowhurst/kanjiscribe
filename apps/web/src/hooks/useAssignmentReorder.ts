import { useCallback, useState } from 'react';
import type { Assignment } from '@kanjiscribe/shared';
import { isUnfinishedStatus } from '@kanjiscribe/shared';

import { reorderAssignments } from '../lib/api.js';

export function useAssignmentReorder(
  date: string | undefined,
  assignments: Assignment[],
  onOptimisticReorder: (assignments: Assignment[]) => void,
  setError: (message: string | null) => void
): {
  handleReorder: (assignments: Assignment[]) => void;
  isReordering: boolean;
} {
  const [isReordering, setIsReordering] = useState(false);

  const handleReorder = useCallback(
    (nextAssignments: Assignment[]) => {
      if (!date || isReordering) {
        return;
      }

      const previousAssignments = assignments;
      onOptimisticReorder(nextAssignments);
      setIsReordering(true);

      reorderAssignments(
        date,
        nextAssignments
          .filter((assignment) => isUnfinishedStatus(assignment.status))
          .map((assignment) => assignment.id)
      )
        .catch((err: unknown) => {
          onOptimisticReorder(previousAssignments);
          setError(err instanceof Error ? err.message : 'Failed to reorder assignments');
        })
        .finally(() => setIsReordering(false));
    },
    [assignments, date, isReordering, onOptimisticReorder, setError]
  );

  return { handleReorder, isReordering };
}
