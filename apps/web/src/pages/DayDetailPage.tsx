import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { RemoveButton } from '../components/RemoveButton.js';
import { useArchiveRemoval } from '../hooks/useArchiveRemoval.js';
import { apiRequest, formatMs } from '../lib/api.js';

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

  const refresh = useCallback(async () => {
    if (!date) {
      return;
    }

    const [assignmentsRes, statsRes] = await Promise.all([
      apiRequest<{ assignments: Assignment[] }>(`/assignments?date=${date}`),
      apiRequest<{ heatmap: DaySummary[] }>(`/stats/dashboard?from=${date}&to=${date}`)
    ]);
    setAssignments(assignmentsRes.assignments);
    const summary = statsRes.heatmap.find((d) => d.date === date);
    setDaySummary(summary ?? null);
  }, [date]);

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load day details'));
  }, [refresh]);

  const handleRemove = useArchiveRemoval(refresh, setError);

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

  const remainingAssignments = useMemo(
    () => [...pendingAssignments, ...skippedAssignments],
    [pendingAssignments, skippedAssignments]
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
            {daySummary.completed_count}/{daySummary.total_assignments} completed, {remainingAssignments.length} remaining
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
                  />
                ))}
              </div>
            </section>
          )}

          {remainingAssignments.length > 0 && (
            <section className="day-assignment-group">
              <h3>Remaining ({remainingAssignments.length})</h3>
              <div className="assignment-list">
                {remainingAssignments.map((assignment) => (
                  <DayAssignmentCard
                    key={assignment.id}
                    assignment={assignment}
                    dayDate={date!}
                    onRemove={handleRemove}
                  />
                ))}
              </div>
              <div className="day-drill-actions">
                <Link 
                  className="button button-today" 
                  to={`/drill/${remainingAssignments[0]!.id}?queue_source=today`}
                >
                  Drill remaining words
                </Link>
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
  onRemove
}: {
  assignment: Assignment;
  dayDate: string;
  allIds?: number[];
  onRemove?: (assignment: Assignment) => void;
}) {
  const navigate = useNavigate();
  const isCompleted = assignment.status === 'completed';
  const isSkipped = assignment.status === 'skipped';
  const isPending = assignment.status === 'pending';
  const isRemovable = isPending || isSkipped;

  const viewUrl = allIds && allIds.length > 0
    ? `/word/${assignment.id}?day=${dayDate}&ids=${allIds.join(',')}`
    : `/word/${assignment.id}?day=${dayDate}`;
  const drillUrl = `/drill/${assignment.id}?queue_source=today`;
  const cardUrl = isPending ? drillUrl : viewUrl;

  const removeButton =
    onRemove && isRemovable ? <RemoveButton onConfirm={() => onRemove(assignment)} /> : null;

  return (
    <article
      className={`card assignment-card ${isCompleted ? 'assignment-card--completed' : ''} ${isSkipped ? 'assignment-card--skipped' : ''}`}
      style={{ cursor: 'pointer' }}
      onClick={() => navigate(cardUrl)}
    >
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
      {removeButton}
    </article>
  );
}
