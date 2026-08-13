import type { Assignment } from '@kanjiscribe/shared';

import { AssignmentCard, AssignmentCardPreview } from './AssignmentCard.js';
import { ReorderableAssignmentList, type SortableAssignment } from './ReorderableAssignmentList.js';
import { formatJapaneseDate } from '../lib/api.js';

export function AssignmentList({
  assignments,
  queueSource,
  getDrillQuery,
  variant,
  onRemove,
  removingId,
  onReorder,
  isReordering
}: {
  assignments: Assignment[];
  queueSource?: 'today' | 'backlog';
  getDrillQuery?: (assignment: Assignment) => string;
  variant?: 'today';
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
      className={`assignment-list ${variant === 'today' ? 'assignment-list--today' : ''}`}
      renderItem={(assignment, sortable) => (
        <SortableAssignmentCard
          key={assignment.id}
          assignment={assignment}
          cardUrl={getAssignmentUrl(assignment, queueSource, getDrillQuery)}
          variant={variant}
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

function SortableAssignmentCard({
  assignment,
  cardUrl,
  variant,
  onRemove,
  removingId,
  isReordering,
  sortable
}: {
  assignment: Assignment;
  cardUrl: string;
  variant?: 'today';
  onRemove?: (assignment: Assignment) => void;
  removingId?: number | null;
  isReordering: boolean;
  sortable: SortableAssignment;
}) {
  const isCompleted = assignment.status === 'completed';

  return (
    <AssignmentCard
      assignment={assignment}
      cardUrl={cardUrl}
      className={variant === 'today' && isCompleted ? 'assignment-card--today-completed' : ''}
      onRemove={onRemove}
      removingId={removingId}
      isReordering={isReordering}
      sortable={sortable}
      meta={
        <>
          {formatJapaneseDate(assignment.assigned_for_date)} - {assignment.status}
        </>
      }
    />
  );
}

function getAssignmentUrl(
  assignment: Assignment,
  queueSource?: 'today' | 'backlog',
  getDrillQuery?: (assignment: Assignment) => string
): string {
  const drillQuery =
    getDrillQuery?.(assignment) ?? (queueSource ? `?queue_source=${queueSource}` : '');
  return assignment.status === 'completed'
    ? `/word/${assignment.id}?day=${assignment.assigned_for_date}`
    : `/drill/${assignment.id}${drillQuery}`;
}
