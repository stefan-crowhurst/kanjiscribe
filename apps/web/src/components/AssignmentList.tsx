import { useNavigate } from 'react-router-dom';
import type { Assignment } from '@kanjiscribe/shared';

import { RemoveButton } from './RemoveButton.js';
import { formatJapaneseDate } from '../lib/api.js';

export function AssignmentList({
  assignments,
  queueSource,
  getDrillQuery,
  variant,
  onRemove
}: {
  assignments: Assignment[];
  queueSource?: 'today' | 'backlog';
  getDrillQuery?: (assignment: Assignment) => string;
  variant?: 'today';
  onRemove?: (assignment: Assignment) => void;
}) {
  const navigate = useNavigate();

  if (assignments.length === 0) {
    return <p className="muted">No assignments found.</p>;
  }

  return (
    <div className={`assignment-list ${variant === 'today' ? 'assignment-list--today' : ''}`}>
      {assignments.map((assignment) => {
        const isPending = assignment.status === 'pending';
        const isCompleted = assignment.status === 'completed';
        const isRemovable = isPending || assignment.status === 'skipped';
        const cardClassName = `card assignment-card ${isCompleted ? 'assignment-card--completed' : ''} ${variant === 'today' && isCompleted ? 'assignment-card--today-completed' : ''}`;

        const drillQuery = getDrillQuery?.(assignment) ?? (queueSource ? `?queue_source=${queueSource}` : '');
        const drillPath = `/drill/${assignment.id}${drillQuery}`;
        const viewPath = `/word/${assignment.id}?day=${assignment.assigned_for_date}`;
        const cardUrl = isCompleted ? viewPath : drillPath;

        return (
          <article
            key={assignment.id}
            className={cardClassName}
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(cardUrl)}
          >
            <div className="assignment-card-content">
              <strong>{assignment.study_item.surface_form}</strong>
              <p className="kana">{assignment.study_item.selected_reading}</p>
              <p>{assignment.study_item.first_gloss ?? 'No gloss available'}</p>
              <small>
                {formatJapaneseDate(assignment.assigned_for_date)} - {assignment.status}
              </small>
            </div>
            {onRemove && isRemovable ? (
              <RemoveButton onConfirm={() => onRemove(assignment)} />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
