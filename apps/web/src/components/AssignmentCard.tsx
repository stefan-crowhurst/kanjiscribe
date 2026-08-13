import type { ReactNode } from 'react';
import type { Assignment } from '@kanjiscribe/shared';
import { isUnfinishedStatus } from '@kanjiscribe/shared';
import { useNavigate } from 'react-router-dom';

import { formatJapaneseDate } from '../lib/api.js';
import { RemoveButton } from './RemoveButton.js';
import { AssignmentDragHandle, type SortableAssignment } from './ReorderableAssignmentList.js';

/**
 * The full-height grabber rail on the left of a reorderable card (Today/
 * Backlog via AssignmentList, Day detail): the drag handle sits centered in
 * it. Rendered only for unfinished assignments — completed assignments are
 * fixed anchors and get no handle.
 */
export function AssignmentCardGrabber({
  assignment,
  sortable,
  isReordering = false
}: {
  assignment: Assignment;
  sortable?: SortableAssignment;
  isReordering?: boolean;
}) {
  if (!isUnfinishedStatus(assignment.status) || !sortable) {
    return null;
  }

  return (
    <div className="assignment-card-grabber">
      <AssignmentDragHandle
        sortable={sortable}
        label={`Reorder ${assignment.study_item.surface_form}`}
        disabled={isReordering}
      />
    </div>
  );
}

/**
 * The remove-action block on the right of an assignment card, shared by
 * every list surface. Rendered only for unfinished assignments; completed
 * assignments are never removable.
 */
export function AssignmentCardActions({
  assignment,
  onRemove,
  removingId
}: {
  assignment: Assignment;
  onRemove?: (assignment: Assignment) => void;
  removingId?: number | null;
}) {
  if (!isUnfinishedStatus(assignment.status) || !onRemove) {
    return null;
  }

  return (
    <div className="assignment-card-actions">
      <RemoveButton onConfirm={() => onRemove(assignment)} pending={assignment.id === removingId} />
    </div>
  );
}

/**
 * The card body shared by every assignment surface: surface form, kana
 * reading, first gloss, and the surface-specific meta line.
 */
export function AssignmentCardContent({
  assignment,
  meta
}: {
  assignment: Assignment;
  meta: ReactNode;
}) {
  return (
    <div className="assignment-card-content">
      <strong>{assignment.study_item.surface_form}</strong>
      <p className="kana">{assignment.study_item.selected_reading}</p>
      <p>{assignment.study_item.first_gloss ?? 'No gloss available'}</p>
      <small>{meta}</small>
    </div>
  );
}

/**
 * The drag-overlay preview shown while a card is being dragged, shared by the
 * Today/Backlog list and the Day detail page.
 */
export function AssignmentCardPreview({ assignment }: { assignment: Assignment }) {
  return (
    <article className="card assignment-card assignment-card--drag-overlay">
      <AssignmentCardContent
        assignment={assignment}
        meta={
          <>
            {formatJapaneseDate(assignment.assigned_for_date)} - {assignment.status}
          </>
        }
      />
    </article>
  );
}

/**
 * The full assignment card shell shared by the Today/Backlog list and the Day
 * detail page: click-to-open navigation, the drag transform, grabber, body,
 * and remove actions. `meta` is the surface-specific status/time line.
 */
export function AssignmentCard({
  assignment,
  className = '',
  cardUrl,
  onRemove,
  removingId,
  isReordering = false,
  sortable,
  meta
}: {
  assignment: Assignment;
  className?: string;
  cardUrl: string;
  onRemove?: (assignment: Assignment) => void;
  removingId?: number | null;
  isReordering?: boolean;
  sortable?: SortableAssignment;
  meta: ReactNode;
}) {
  const navigate = useNavigate();
  const isCompleted = assignment.status === 'completed';
  const isRemoving = assignment.id === removingId;
  const { setNodeRef, transform, transition, isDragging } = sortable ?? {};
  const isUnfinished = isUnfinishedStatus(assignment.status);

  return (
    <article
      ref={setNodeRef}
      className={`card assignment-card ${isCompleted ? 'assignment-card--completed' : ''} ${className} ${isDragging ? 'assignment-card--dragging' : ''}`}
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
      <AssignmentCardGrabber assignment={assignment} sortable={sortable} isReordering={isReordering} />
      <AssignmentCardContent assignment={assignment} meta={meta} />
      <AssignmentCardActions assignment={assignment} onRemove={onRemove} removingId={removingId} />
    </article>
  );
}
