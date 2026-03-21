import { Link } from 'react-router-dom';

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
  variant
}: {
  assignments: Assignment[];
  queueSource?: 'today' | 'backlog';
  getDrillQuery?: (assignment: Assignment) => string;
  showDrillButton?: boolean;
  variant?: 'today';
}) {
  if (assignments.length === 0) {
    return <p className="muted">No assignments found.</p>;
  }

  return (
    <div className={`assignment-list ${variant === 'today' ? 'assignment-list--today' : ''}`}>
      {assignments.map((assignment) => {
        const drillQuery = getDrillQuery?.(assignment) ?? (queueSource ? `?queue_source=${queueSource}` : '');
        const isCompleted = assignment.status === 'completed';
        return (
          <article 
            key={assignment.id} 
            className={`card assignment-card ${isCompleted ? 'assignment-card--completed' : ''} ${variant === 'today' && isCompleted ? 'assignment-card--today-completed' : ''}`}
          >
            <Link className="assignment-card-link" to={`/drill/${assignment.id}${drillQuery}`}>
              <div className="assignment-card-content">
                <strong>{assignment.study_item.surface_form}</strong>
                <p className="kana">{assignment.study_item.selected_reading}</p>
                <p>{assignment.study_item.first_gloss ?? 'No gloss available'}</p>
                <small>
                  {formatShortDate(assignment.assigned_for_date)} - {assignment.status}
                </small>
              </div>
            </Link>
            {showDrillButton ? (
              <Link className="button" to={`/drill/${assignment.id}${drillQuery}`}>
                Drill
              </Link>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
