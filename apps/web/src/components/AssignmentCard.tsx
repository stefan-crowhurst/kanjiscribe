import type { Assignment } from '@kanjiscribe/shared';
import { isUnfinishedStatus } from '@kanjiscribe/shared';

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
 * The drag-overlay preview shown while a card is being dragged, shared by the
 * Today/Backlog list and the Day detail page.
 */
export function AssignmentCardPreview({ assignment }: { assignment: Assignment }) {
  return (
    <article className="card assignment-card assignment-card--drag-overlay">
      <div className="assignment-card-content">
        <strong>{assignment.study_item.surface_form}</strong>
        <p className="kana">{assignment.study_item.selected_reading}</p>
        <p>{assignment.study_item.first_gloss ?? 'No gloss available'}</p>
        <small>
          {formatJapaneseDate(assignment.assigned_for_date)} - {assignment.status}
        </small>
      </div>
    </article>
  );
}
