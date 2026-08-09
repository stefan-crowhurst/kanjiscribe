import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type Assignment, type HeatmapDay } from '@kanjiscribe/shared';

import { AssignmentList } from '../components/AssignmentList.js';
import { DeltaChip } from '../components/DeltaChip.js';
import { LoadingState } from '../components/LoadingState.js';
import { useArchiveRemoval } from '../hooks/useArchiveRemoval.js';
import { formatEstimateLabel, useEstimate } from '../hooks/useEstimate.js';
import { formatJapaneseDate, getDashboardStats, listAssignments, todayDateString } from '../lib/api.js';

type DayStats = Pick<HeatmapDay, 'total_assignments' | 'completed_count' | 'pending_count'>;

export function TodayPage() {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [dayStats, setDayStats] = useState<DayStats | null>(null);
  const [dayDeltaMs, setDayDeltaMs] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const todayEstimate = useEstimate('today');

  const refresh = useCallback(async () => {
    const today = todayDateString();
    const [assignmentsRes, statsRes] = await Promise.all([
      listAssignments({ date: today }),
      getDashboardStats(today, today)
    ]);
    setAssignments(assignmentsRes.assignments);
    const todayStats = statsRes.heatmap.find((d) => d.date === today);
    setDayStats(
      todayStats
        ? {
            total_assignments: todayStats.total_assignments,
            completed_count: todayStats.completed_count,
            pending_count: todayStats.pending_count
          }
        : null
    );
    // Server-gated day verdict: null when today is unfinished; numeric once
    // today is strictly fully completed with full snapshot coverage. Kept
    // distinct from the not-yet-loaded state so the verdict renders only
    // once the server has actually returned a value.
    setDayDeltaMs(todayStats ? todayStats.estimate_delta_ms : null);
  }, []);

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load today assignments'));
  }, [refresh]);

  const { handleRemove, removingId } = useArchiveRemoval(refresh, setError);

  const completed = dayStats?.completed_count ?? 0;
  const total = dayStats?.total_assignments ?? assignments?.length ?? 0;
  const unfinishedAssignments =
    assignments?.filter((a) => a.status === 'pending' || a.status === 'skipped') ?? [];
  const remaining = unfinishedAssignments.length;
  const countsKnown = dayStats !== null || assignments !== null;

  const firstUnfinishedId = unfinishedAssignments[0]?.id;
  const todayEstimateLabel = formatEstimateLabel(todayEstimate);

  return (
    <section>
      <div className="today-header">
        <div>
          <h2>Today</h2>
          <p className="muted today-date">{formatJapaneseDate(todayDateString())}</p>
          {countsKnown ? (
            <p className="muted">
              {completed}/{total} drilled, {remaining} remaining
            </p>
          ) : (
            <LoadingState message="Loading today's stats..." />
          )}
          <p className="muted">
            Estimate: {todayEstimateLabel}
          </p>
        </div>
        {firstUnfinishedId ? (
          <Link className="button button-today" to={`/drill/${firstUnfinishedId}?queue_source=today`}>
            Drill
          </Link>
        ) : null}
      </div>
      {typeof dayDeltaMs === 'number' ? (
        <p className="today-day-verdict">
          Day verdict: <DeltaChip deltaMs={dayDeltaMs} />
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
      {assignments === null ? (
        <LoadingState message="Loading today's assignments..." />
      ) : (
        <AssignmentList
          assignments={assignments}
          queueSource="today"
          variant="today"
          onRemove={handleRemove}
          removingId={removingId}
        />
      )}
    </section>
  );
}
