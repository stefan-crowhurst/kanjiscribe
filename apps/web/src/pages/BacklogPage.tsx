import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { AssignmentList } from '../components/AssignmentList.js';
import { apiRequest, formatShortDate } from '../lib/api.js';

type AssignmentsResponse = {
  assignments: Array<{
    id: number;
    assigned_for_date: string;
    status: string;
    study_item: { surface_form: string; selected_reading: string; first_gloss: string | null };
  }>;
};

export function BacklogPage() {
  const [data, setData] = useState<AssignmentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<AssignmentsResponse>('/assignments/backlog')
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load backlog'));
  }, []);

  const groupedAssignments = useMemo(() => {
    const groups = new Map<string, AssignmentsResponse['assignments']>();
    for (const assignment of data?.assignments ?? []) {
      const existing = groups.get(assignment.assigned_for_date);
      if (existing) {
        existing.push(assignment);
      } else {
        groups.set(assignment.assigned_for_date, [assignment]);
      }
    }

    return Array.from(groups.entries()).map(([date, assignments]) => ({ date, assignments }));
  }, [data?.assignments]);

  function dayDrillQuery(date: string, assignmentIds: number[]): string {
    const params = new URLSearchParams({
      queue_source: 'backlog',
      queue_ids: assignmentIds.join(','),
      queue_label: date
    });
    return `?${params.toString()}`;
  }

  return (
    <section>
      <h2>Backlog</h2>
      <p className="muted">All pending and skipped assignments, oldest first.</p>
      {error ? <p className="error">{error}</p> : null}
      {groupedAssignments.length === 0 ? (
        <p className="muted">No assignments found.</p>
      ) : (
        <div className="backlog-day-list">
          {groupedAssignments.map((group) => {
            const query = dayDrillQuery(
              formatShortDate(group.date),
              group.assignments.map((assignment) => assignment.id)
            );

            return (
              <section key={group.date} className="backlog-day-group">
                <div className="backlog-day-header">
                  <h3>{formatShortDate(group.date)}</h3>
                  <Link className="button button-backlog-filled" to={`/drill/${group.assignments[0].id}${query}`}>
                    Drill day
                  </Link>
                </div>
                <AssignmentList assignments={group.assignments} getDrillQuery={() => query} />
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
