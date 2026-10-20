import type { Assignment, AssignmentStatus } from '@kanjiscribe/shared';
import { isUnfinishedStatus } from '@kanjiscribe/shared';
import { useNavigate } from 'react-router-dom';

import { formatMs } from '../lib/api.js';
import { DeltaChip } from './DeltaChip.js';
import { RemoveButton } from './RemoveButton.js';
import {
  AssignmentDragGrip,
  AssignmentDragHandle,
  type SortableAssignment
} from './ReorderableAssignmentList.js';

/**
 * The full-height grabber rail on the left of a list card (Today/Backlog via
 * AssignmentList, Day detail). Unfinished assignments get the active drag
 * handle; completed assignments are fixed anchors, so they keep the rail and
 * a disabled handle instead. Keeping the rail on every card aligns the card
 * content whether or not the assignment can be moved.
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
  const isUnfinished = isUnfinishedStatus(assignment.status);

  if (!isUnfinished) {
    return (
      <div className="assignment-card-grabber assignment-card-grabber--locked">
        <button
          type="button"
          className="assignment-drag-handle assignment-drag-handle--locked"
          aria-label={`Reorder ${assignment.study_item.surface_form}`}
          title="Completed assignments cannot be reordered"
          disabled
        >
          <AssignmentDragGrip />
        </button>
      </div>
    );
  }

  if (!sortable) {
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
 * Humanised status labels — the single display mapping from assignment
 * status to interface copy. The enum values themselves are unchanged.
 */
const STATUS_LABELS: Record<AssignmentStatus, string> = {
  pending: 'Pending',
  skipped: 'Skipped',
  completed: 'Completed',
  archived: 'Archived'
};

/**
 * The card's meta line, derived entirely from the assignment: humanised
 * status always; on a completed card with a recorded time, that time and —
 * when an estimate snapshot exists — the shared estimate delta chip. No
 * date: the day already sits in the page or group header. Pending and
 * skipped never show time or delta.
 */
function AssignmentCardMeta({ assignment }: { assignment: Assignment }) {
  if (assignment.status === 'completed' && assignment.time_spent_ms !== null) {
    return (
      <>
        Time: {formatMs(assignment.time_spent_ms)}
        {assignment.estimated_ms !== null && (
          <>
            {' '}
            <DeltaChip deltaMs={assignment.time_spent_ms - assignment.estimated_ms} />
          </>
        )}
        {' • '}
        {STATUS_LABELS.completed}
      </>
    );
  }

  return <>{STATUS_LABELS[assignment.status]}</>;
}

/**
 * The card body shared by every assignment surface: surface form, kana
 * reading, first gloss, and the meta line derived from the assignment.
 */
export function AssignmentCardContent({ assignment }: { assignment: Assignment }) {
  return (
    <div className="assignment-card-content">
      <strong>{assignment.study_item.surface_form}</strong>
      <p className="kana">{assignment.study_item.selected_reading}</p>
      <p>{assignment.study_item.first_gloss ?? 'No gloss available'}</p>
      <small>
        <AssignmentCardMeta assignment={assignment} />
      </small>
    </div>
  );
}

/**
 * The drag-overlay preview shown while a card is being dragged, shared by the
 * Today/Backlog list and the Day detail page. It reuses the card's content
 * and meta renderer, so it always matches the card it replaces — with no
 * grabber and no remove actions.
 */
export function AssignmentCardPreview({ assignment }: { assignment: Assignment }) {
  const isCompleted = assignment.status === 'completed';

  return (
    <article
      className={`card assignment-card ${isCompleted ? 'assignment-card--completed' : ''} assignment-card--drag-overlay`}
    >
      <AssignmentCardContent assignment={assignment} />
    </article>
  );
}

/**
 * The full assignment card shell shared by the Today/Backlog list and the Day
 * detail page: click-to-open navigation, the drag transform, grabber, body,
 * and remove actions. The meta line and completed styling are derived from
 * the assignment itself.
 *
 * The card is keyboard operable with link semantics: a tab stop whose Enter
 * opens the same destination as a click, an accessible name from its
 * content, and a visible focus ring. Space does not activate it, matching
 * link behaviour. The nested drag handle and Remove button keep their own
 * focus stops and activation; Enter bubbling up from them must never open
 * the card.
 */
export function AssignmentCard({
  assignment,
  className = '',
  cardUrl,
  onRemove,
  removingId,
  isReordering = false,
  sortable
}: {
  assignment: Assignment;
  className?: string;
  cardUrl: string;
  onRemove?: (assignment: Assignment) => void;
  removingId?: number | null;
  isReordering?: boolean;
  sortable?: SortableAssignment;
}) {
  const navigate = useNavigate();
  const isCompleted = assignment.status === 'completed';
  const isRemoving = assignment.id === removingId;
  const { setNodeRef, transform, transition, isDragging } = sortable ?? {};
  const isUnfinished = isUnfinishedStatus(assignment.status);

  const activate = () => {
    if (isRemoving) {
      return;
    }
    navigate(cardUrl);
  };

  return (
    <article
      ref={setNodeRef}
      role="link"
      tabIndex={0}
      className={`card assignment-card ${isCompleted ? 'assignment-card--completed' : ''} ${className} ${isDragging ? 'assignment-card--dragging' : ''}`}
      style={{
        cursor: 'pointer',
        transform:
          isUnfinished && transform
            ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
            : undefined,
        transition
      }}
      onClick={activate}
      onKeyDown={(event) => {
        // Link semantics: Enter opens the card's destination, Space does
        // not. The target guard keeps keys pressed on the nested drag
        // handle or Remove button from bubbling into the card's activation.
        if (event.key !== 'Enter' || event.target !== event.currentTarget) {
          return;
        }
        activate();
      }}
    >
      <AssignmentCardGrabber assignment={assignment} sortable={sortable} isReordering={isReordering} />
      <AssignmentCardContent assignment={assignment} />
      <AssignmentCardActions assignment={assignment} onRemove={onRemove} removingId={removingId} />
    </article>
  );
}
