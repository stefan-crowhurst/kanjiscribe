import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { apiRequest, formatMs, formatShortDate } from '../lib/api.js';

type Assignment = {
  id: number;
  assigned_for_date: string;
  status: string;
  time_spent_ms: number | null;
  study_item: { 
    surface_form: string; 
    selected_reading: string; 
    first_gloss: string | null;
  };
};

type DaySummary = {
  date: string;
  total_assignments: number;
  completed_count: number;
  pending_count: number;
  skipped_count: number;
  total_time_ms: number;
  is_fully_completed: boolean;
};

export function DayDetailPage() {
  const { date } = useParams();
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [daySummary, setDaySummary] = useState<DaySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!date) {
      return;
    }

    Promise.all([
      apiRequest<{ assignments: Assignment[] }>(`/assignments?date=${date}`),
      apiRequest<{ heatmap: DaySummary[] }>(`/stats/dashboard?from=${date}&to=${date}`)
    ])
      .then(([assignmentsRes, statsRes]) => {
        setAssignments(assignmentsRes.assignments);
        const summary = statsRes.heatmap.find((d) => d.date === date);
        setDaySummary(summary ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load day details'));
  }, [date]);

  const sortedAssignments = useMemo(() => {
    if (!assignments) return [];
    return [...assignments].sort((a, b) => {
      if (a.status === 'completed' && b.status !== 'completed') return -1;
      if (a.status !== 'completed' && b.status === 'completed') return 1;
      return 0;
    });
  }, [assignments]);

  const completedAssignments = useMemo(() => 
    sortedAssignments.filter((a) => a.status === 'completed'),
    [sortedAssignments]
  );

  const pendingAssignments = useMemo(() => 
    sortedAssignments.filter((a) => a.status === 'pending'),
    [sortedAssignments]
  );

  const skippedAssignments = useMemo(() => 
    sortedAssignments.filter((a) => a.status === 'skipped'),
    [sortedAssignments]
  );

  const completedIds = useMemo(() => 
    completedAssignments.map((a) => a.id),
    [completedAssignments]
  );

  const pendingIds = useMemo(() => 
    pendingAssignments.map((a) => a.id),
    [pendingAssignments]
  );

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!assignments || !daySummary) {
    return <p className="muted">Loading day details...</p>;
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(d);
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const yy = String(d.getUTCFullYear()).slice(-2);
    return `${dayName} ${dd}/${mm}/${yy}`;
  };

  return (
    <section>
      <div className="day-detail-header">
        <div>
          <h2>{formatDate(date!)}</h2>
          <p className="muted">
            {daySummary.completed_count}/{daySummary.total_assignments} completed, {daySummary.pending_count} pending, {daySummary.skipped_count} skipped
            {daySummary.total_time_ms > 0 && (
              <span> • Total time: {formatMs(daySummary.total_time_ms)}</span>
            )}
          </p>
        </div>
      </div>

      {assignments.length === 0 ? (
        <p className="muted">No assignments for this date.</p>
      ) : (
        <div className="day-assignments-list">
          {completedAssignments.length > 0 && (
            <section className="day-assignment-group">
              <h3>Completed ({completedAssignments.length})</h3>
              <div className="assignment-list">
                {completedAssignments.map((assignment) => (
                  <DayAssignmentCard
                    key={assignment.id}
                    assignment={assignment}
                    dayDate={date!}
                    allIds={completedIds}
                    isViewOnly={true}
                  />
                ))}
              </div>
            </section>
          )}

          {pendingAssignments.length > 0 && (
            <section className="day-assignment-group">
              <h3>Pending ({pendingAssignments.length})</h3>
              <div className="assignment-list">
                {pendingAssignments.map((assignment) => (
                  <DayAssignmentCard
                    key={assignment.id}
                    assignment={assignment}
                    dayDate={date!}
                    isViewOnly={false}
                  />
                ))}
              </div>
              {pendingAssignments.length > 0 && (
                <div className="day-drill-actions">
                  <Link 
                    className="button button-today" 
                    to={`/drill/${pendingAssignments[0]!.id}?queue_source=today`}
                  >
                    Drill pending words
                  </Link>
                </div>
              )}
            </section>
          )}

          {skippedAssignments.length > 0 && (
            <section className="day-assignment-group">
              <h3>Skipped ({skippedAssignments.length})</h3>
              <div className="assignment-list">
                {skippedAssignments.map((assignment) => (
                  <DayAssignmentCard
                    key={assignment.id}
                    assignment={assignment}
                    dayDate={date!}
                    isViewOnly={true}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </section>
  );
}

function DayAssignmentCard({
  assignment,
  dayDate,
  allIds,
  isViewOnly
}: {
  assignment: Assignment;
  dayDate: string;
  allIds?: number[];
  isViewOnly: boolean;
}) {
  const isCompleted = assignment.status === 'completed';
  const isSkipped = assignment.status === 'skipped';
  
  const viewUrl = allIds && allIds.length > 0
    ? `/word/${assignment.id}?day=${dayDate}&ids=${allIds.join(',')}`
    : `/word/${assignment.id}?day=${dayDate}`;
  const drillUrl = `/drill/${assignment.id}?queue_source=today`;

  return (
    <article className={`card assignment-card ${isCompleted ? 'assignment-card--completed' : ''} ${isSkipped ? 'assignment-card--skipped' : ''}`}>
      {isViewOnly ? (
        <Link className="assignment-card-link" to={viewUrl}>
          <div className="assignment-card-content">
            <strong>{assignment.study_item.surface_form}</strong>
            <p className="kana">{assignment.study_item.selected_reading}</p>
            <p>{assignment.study_item.first_gloss ?? 'No gloss available'}</p>
            <small>
              {isCompleted && assignment.time_spent_ms !== null && (
                <span>Time: {formatMs(assignment.time_spent_ms)} • </span>
              )}
              {assignment.status}
            </small>
          </div>
        </Link>
      ) : (
        <Link className="assignment-card-link" to={drillUrl}>
          <div className="assignment-card-content">
            <strong>{assignment.study_item.surface_form}</strong>
            <p className="kana">{assignment.study_item.selected_reading}</p>
            <p>{assignment.study_item.first_gloss ?? 'No gloss available'}</p>
            <small>{assignment.status}</small>
          </div>
        </Link>
      )}
      {isViewOnly ? (
        <Link className="button" to={viewUrl}>
          View
        </Link>
      ) : (
        <Link className="button" to={drillUrl}>
          Drill
        </Link>
      )}
    </article>
  );
}
