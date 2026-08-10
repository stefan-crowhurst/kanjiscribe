import type { Assignment } from '@kanjiscribe/shared';
import { isUnfinishedStatus } from '@kanjiscribe/shared';
import { useNavigate } from 'react-router-dom';

import {
  AssignmentCardActions,
  AssignmentCardGrabber,
  AssignmentCardPreview
} from './AssignmentCard.js';
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
  const navigate = useNavigate();

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
          navigate={navigate}
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
  navigate,
  sortable
}: {
  assignment: Assignment;
  cardUrl: string;
  variant?: 'today';
  onRemove?: (assignment: Assignment) => void;
  removingId?: number | null;
  isReordering: boolean;
  navigate: (to: string) => void;
  sortable: SortableAssignment;
}) {
  const isUnfinished = isUnfinishedStatus(assignment.status);
  const isCompleted = assignment.status === 'completed';
  const isRemoving = assignment.id === removingId;
  const { setNodeRef, transform, transition, isDragging } = sortable;
  const cardClassName = `card assignment-card ${isCompleted ? 'assignment-card--completed' : ''} ${variant === 'today' && isCompleted ? 'assignment-card--today-completed' : ''} ${isDragging ? 'assignment-card--dragging' : ''}`;

  return (
    <article
      ref={setNodeRef}
      className={cardClassName}
      style={{
        cursor: 'pointer',
        transform:
          isUnfinished && transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
        transition
      }}
      onClick={() => {
        if (isRemoving) {
          return;
        }
        navigate(cardUrl);
      }}
    >
      <AssignmentCardGrabber
        assignment={assignment}
        sortable={sortable}
        isReordering={isReordering}
      />
      <div className="assignment-card-content">
        <strong>{assignment.study_item.surface_form}</strong>
        <p className="kana">{assignment.study_item.selected_reading}</p>
        <p>{assignment.study_item.first_gloss ?? 'No gloss available'}</p>
        <small>
          {formatJapaneseDate(assignment.assigned_for_date)} - {assignment.status}
        </small>
      </div>
      <AssignmentCardActions assignment={assignment} onRemove={onRemove} removingId={removingId} />
    </article>
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
