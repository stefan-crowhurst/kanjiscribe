import { useNavigate } from 'react-router-dom';

import { RemoveButton } from './RemoveButton.js';
import { formatShortDate } from '../lib/api.js';

type Assignment = {
  id: number;
  assigned_for_date: string;
  status: string;
  study_item: {
    surface_form: string;
    selected_reading: string;
    first_gloss: string | null;
  };
};

export function AssignmentList({
  assignments,
  queueSource,
  getDrillQuery,
  showDrillButton = true,
  variant,
  onRemove
}: {
  assignments: Assignment[];
  queueSource?: 'today' | 'backlog';
  getDrillQuery?: (assignment: Assignment) => string;
  showDrillButton?: boolean;
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
        const drillQuery = getDrillQuery?.(assignment) ?? (queueSource ? `?queue_source=${queueSource}` : '');
        const drillPath = `/drill/${assignment.id}${drillQuery}`;
        const isCompleted = assignment.status === 'completed';
        const cardClassName = `card assignment-card ${isCompleted ? 'assignment-card--completed' : ''} ${variant === 'today' && isCompleted ? 'assignment-card--today-completed' : ''}`;
        const isRemovable = assignment.status === 'pending' || assignment.status === 'skipped';
        const hasButton = showDrillButton || (onRemove && isRemovable);

        const content = (
          <div className="assignment-card-content">
            <strong>{assignment.study_item.surface_form}</strong>
            <p className="kana">{assignment.study_item.selected_reading}</p>
            <p>{assignment.study_item.first_gloss ?? 'No gloss available'}</p>
            <small>
              {formatShortDate(assignment.assigned_for_date)} - {assignment.status}
            </small>
          </div>
        );

        const removeButton =
          onRemove && isRemovable ? (
            <RemoveButton onConfirm={() => onRemove(assignment)} />
          ) : null;

        if (!hasButton) {
          return (
            <article
              key={assignment.id}
              className={cardClassName}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(drillPath)}
            >
              {content}
            </article>
          );
        }

        return (
          <article
            key={assignment.id}
            className={cardClassName}
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(drillPath)}
          >
            {content}
            {showDrillButton ? (
              <button
                className="button"
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(drillPath);
                }}
              >
                Drill
              </button>
            ) : null}
            {removeButton}
          </article>
        );
      })}
    </div>
  );
}