import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  dateSchema,
  interleaveUnfinished,
  isUnfinishedStatus,
  type Assignment,
  type HeatmapDay
} from '@kanjiscribe/shared';

import { AssignmentCard, AssignmentCardPreview } from '../components/AssignmentCard.js';
import { DeltaChip } from '../components/DeltaChip.js';
import {
  ReorderableAssignmentList,
  type SortableAssignment
} from '../components/ReorderableAssignmentList.js';
import { useArchiveRemoval } from '../hooks/useArchiveRemoval.js';
import { useAssignmentReorder } from '../hooks/useAssignmentReorder.js';
import { formatMs, getDashboardStats, listAssignments } from '../lib/api.js';

export function DayDetailPage() {
  const { date } = useParams();
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [daySummary, setDaySummary] = useState<HeatmapDay | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!date) {
      return;
    }

    // The route date parses through the shared date schema (ADR-0006): a
    // malformed date rejects here — surfacing the page's error state —
    // instead of reaching the request builders or the date math in
    // formatDate.
    const parsedDate = dateSchema.safeParse(date);
    if (!parsedDate.success) {
      throw new Error('Invalid date');
    }

    const [assignmentsRes, statsRes] = await Promise.all([
      listAssignments({ date: parsedDate.data }),
      getDashboardStats(parsedDate.data, parsedDate.data)
    ]);
    setAssignments(assignmentsRes.assignments);
    const summary = statsRes.heatmap.find((d) => d.date === date);
    setDaySummary(summary ?? null);
  }, [date]);

  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof Error ? err.message : 'Failed to load day details')
    );
  }, [refresh]);

  const { handleRemove, removingId } = useArchiveRemoval(refresh, setError);

  const completedAssignments = useMemo(
    () => (assignments ?? []).filter((a) => a.status === 'completed'),
    [assignments]
  );

  const completedIds = useMemo(() => completedAssignments.map((a) => a.id), [completedAssignments]);

  const remainingAssignments = useMemo(
    () => (assignments ?? []).filter((a) => isUnfinishedStatus(a.status)),
    [assignments]
  );

  const applyOptimisticReorder = useCallback((nextRemaining: Assignment[]) => {
    setAssignments((current) => {
      if (!current) {
        return current;
      }
      return interleaveUnfinished(current, nextRemaining);
    });
  }, []);

  const { handleReorder, isReordering } = useAssignmentReorder(
    date,
    remainingAssignments,
    applyOptimisticReorder,
    setError
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
            {daySummary.completed_count}/{daySummary.total_assignments} completed,{' '}
            {remainingAssignments.length} remaining
            {daySummary.total_time_ms > 0 && (
              <span>
                {' '}
                • Total time: {formatMs(daySummary.total_time_ms)}
                {daySummary.estimate_delta_ms !== null && (
                  <>
                    {' '}
                    <DeltaChip deltaMs={daySummary.estimate_delta_ms} />
                  </>
                )}
              </span>
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
              <div className="day-remaining-header">
                <h3>Remaining ({remainingAssignments.length})</h3>
                <Link
                  className="button button-today"
                  to={`/drill/${remainingAssignments[0]!.id}?queue_source=today`}
                >
                  Drill
                </Link>
              </div>
              <ReorderableAssignmentList
                assignments={remainingAssignments}
                onReorder={handleReorder}
                isReordering={isReordering}
                renderItem={(assignment, sortable) => (
                  <DayAssignmentCard
                    key={assignment.id}
                    assignment={assignment}
                    dayDate={date!}
                    onRemove={handleRemove}
                    removingId={removingId}
                    isReordering={isReordering}
                    sortable={sortable}
                  />
                )}
                renderOverlay={(assignment) => <AssignmentCardPreview assignment={assignment} />}
              />
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
  onRemove,
  removingId,
  isReordering = false,
  sortable
}: {
  assignment: Assignment;
  dayDate: string;
  allIds?: number[];
  onRemove?: (assignment: Assignment) => void;
  removingId?: number | null;
  isReordering?: boolean;
  sortable?: SortableAssignment;
}) {
  const isCompleted = assignment.status === 'completed';

  const viewUrl =
    allIds && allIds.length > 0
      ? `/word/${assignment.id}?day=${dayDate}&ids=${allIds.join(',')}`
      : `/word/${assignment.id}?day=${dayDate}`;
  const drillUrl = `/drill/${assignment.id}?queue_source=today`;
  const cardUrl = isCompleted ? viewUrl : drillUrl;

  return (
    <AssignmentCard
      assignment={assignment}
      cardUrl={cardUrl}
      onRemove={onRemove}
      removingId={removingId}
      isReordering={isReordering}
      sortable={sortable}
      meta={
        <>
          {isCompleted && assignment.time_spent_ms !== null && (
            <span>
              Time: {formatMs(assignment.time_spent_ms)}
              {assignment.estimated_ms !== null && (
                <>
                  {' '}
                  <DeltaChip deltaMs={assignment.time_spent_ms - assignment.estimated_ms} />
                </>
              )}{' '}
              •{' '}
            </span>
          )}
          {assignment.status}
        </>
      }
    />
  );
}
