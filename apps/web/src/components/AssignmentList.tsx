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
  getDrillQuery
}: {
  assignments: Assignment[];
  queueSource?: 'today' | 'backlog';
  getDrillQuery?: (assignment: Assignment) => string;
}) {
  if (assignments.length === 0) {
    return <p className="muted">No assignments found.</p>;
  }

  return (
    <div className="assignment-list">
      {assignments.map((assignment) => {
        const drillQuery = getDrillQuery?.(assignment) ?? (queueSource ? `?queue_source=${queueSource}` : '');
        return (
          <article key={assignment.id} className="card assignment-card">
            <div className="assignment-card-content">
              <strong>{assignment.study_item.surface_form}</strong>
              <p className="kana">{assignment.study_item.selected_reading}</p>
              <p>{assignment.study_item.first_gloss ?? 'No gloss available'}</p>
              <small>
                {formatShortDate(assignment.assigned_for_date)} - {assignment.status}
              </small>
            </div>
            <Link className="button" to={`/drill/${assignment.id}${drillQuery}`}>
              Drill
            </Link>
          </article>
        );
      })}
    </div>
  );
}
