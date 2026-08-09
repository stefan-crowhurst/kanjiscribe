import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { type Assignment, type BacklogResponse } from '@kanjiscribe/shared';

import { AssignmentList } from '../components/AssignmentList.js';
import { LoadingState } from '../components/LoadingState.js';
import { useArchiveRemoval } from '../hooks/useArchiveRemoval.js';
import { formatEstimateLabel, useBacklogDayEstimates } from '../hooks/useEstimate.js';
import { formatJapaneseDate, getBacklog } from '../lib/api.js';

export function BacklogPage() {
  const [data, setData] = useState<BacklogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const refreshed = await getBacklog();
    setData(refreshed);
  }, []);

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load backlog'));
  }, [refresh]);

  const dates = useMemo(
    () => [...new Set(data?.assignments.map((a) => a.assigned_for_date) ?? [])],
    [data?.assignments]
  );
  const dayEstimates = useBacklogDayEstimates(dates);

  const { handleRemove, removingId } = useArchiveRemoval(refresh, setError);

  const groupedAssignments = useMemo(() => {
    const groups = new Map<string, Assignment[]>();
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

  function toggleDay(date: string) {
    setExpandedDays((current) => {
      const next = new Set(current);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  }

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
      {data === null ? (
        <LoadingState message="Loading backlog..." />
      ) : groupedAssignments.length === 0 ? (
        <p className="muted">No assignments found.</p>
      ) : (
        <div className="backlog-day-list">
          {groupedAssignments.map((group) => {
            const isExpanded = expandedDays.has(group.date);
            const stats = data?.dayStats[group.date];
            const completed = stats?.completed_count ?? 0;
            const total = stats?.total_assignments ?? group.assignments.length;
            const remaining = group.assignments.length;
            const estimateState = dayEstimates[group.date];
            const estimateLabel =
              estimateState === undefined || estimateState.status === 'loading'
                ? ' —'
                : ` • ${formatEstimateLabel(estimateState)}`;

            const query = dayDrillQuery(
              formatJapaneseDate(group.date),
              group.assignments.map((assignment) => assignment.id)
            );

            return (
              <section key={group.date} className="backlog-day-group">
                <div className="backlog-day-header">
                  <button
                    className={`backlog-day-toggle ${isExpanded ? 'backlog-day-toggle--expanded' : ''}`}
                    onClick={() => toggleDay(group.date)}
                    aria-expanded={isExpanded}
                  >
                    <span className="backlog-day-chevron" aria-hidden="true">
                      ›
                    </span>
                    <h3>{formatJapaneseDate(group.date)}</h3>
                    <span className="backlog-day-stats">
                      {completed}/{total} drilled, {remaining} remaining
                      {estimateLabel}
                    </span>
                  </button>
                  <Link className="button button-today" to={`/drill/${group.assignments[0]!.id}${query}`}>
                    Drill
                  </Link>
                </div>
                {isExpanded ? (
                  <AssignmentList
                    assignments={group.assignments}
                    getDrillQuery={() => query}
                    onRemove={handleRemove}
                    removingId={removingId}
                  />
                ) : null}
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
