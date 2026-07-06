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
        const drillPath = `/drill/${assignment.id}${drillQuery}`;
        const isCompleted = assignment.status === 'completed';
        const cardClassName = `card assignment-card ${isCompleted ? 'assignment-card--completed' : ''} ${variant === 'today' && isCompleted ? 'assignment-card--today-completed' : ''}`;

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

        if (showDrillButton) {
          return (
            <article key={assignment.id} className={cardClassName}>
              <Link className="assignment-card-link" to={drillPath}>
                {content}
              </Link>
              <Link className="button" to={drillPath}>
                Drill
              </Link>
            </article>
          );
        }

        return (
          <Link key={assignment.id} className="assignment-card-link assignment-card-link--card" to={drillPath}>
            <article className={cardClassName}>
              {content}
            </article>
          </Link>
        );
      })}
    </div>
  );
}
