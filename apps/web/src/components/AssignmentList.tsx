import type { Assignment } from '@kanjiscribe/shared';

import { AssignmentCard, AssignmentCardPreview } from './AssignmentCard.js';
import { ReorderableAssignmentList } from './ReorderableAssignmentList.js';
import { assignmentCardUrl, type DrillQueueSource } from '../lib/assignmentUrls.js';

export function AssignmentList({
  assignments,
  queueSource,
  drillQuery,
  onRemove,
  removingId,
  onReorder,
  isReordering
}: {
  assignments: Assignment[];
  queueSource?: DrillQueueSource;
  drillQuery?: string;
  onRemove?: (assignment: Assignment) => void;
  removingId?: number | null;
  onReorder: (assignments: Assignment[]) => void;
  isReordering: boolean;
}) {
  if (assignments.length === 0) {
    return <p className="muted">No assignments found.</p>;
  }

  return (
    <ReorderableAssignmentList
      assignments={assignments}
      onReorder={onReorder}
      isReordering={isReordering}
      renderItem={(assignment, sortable) => (
        <AssignmentCard
          key={assignment.id}
          assignment={assignment}
          cardUrl={assignmentCardUrl(assignment, { queueSource, drillQuery })}
          onRemove={onRemove}
          removingId={removingId}
          isReordering={isReordering}
          sortable={sortable}
        />
      )}
      renderOverlay={(assignment) => <AssignmentCardPreview assignment={assignment} />}
    />
  );
}
