import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { AssignmentList } from '../components/AssignmentList.js';
import { apiRequest, archiveAssignment, todayDateString } from '../lib/api.js';

type Assignment = {
  id: number;
  assigned_for_date: string;
  status: string;
  study_item: { surface_form: string; selected_reading: string; first_gloss: string | null };
};

type DayStats = {
  total_assignments: number;
  completed_count: number;
  pending_count: number;
};

type DaySummaryResponse = {
  date: string;
  total_assignments: number;
  completed_count: number;
  pending_count: number;
  skipped_count: number;
  total_time_ms: number;
  is_fully_completed: boolean;
};

export function TodayPage() {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null);
  const [dayStats, setDayStats] = useState<DayStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const today = todayDateString();

    Promise.all([
      apiRequest<{ assignments: Assignment[] }>(`/assignments?date=${today}`),
      apiRequest<{ heatmap: DaySummaryResponse[] }>(`/stats/dashboard?from=${today}&to=${today}`)
    ])
      .then(([assignmentsRes, statsRes]) => {
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
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load today assignments'));
  }, []);

  const handleRemove = useCallback(async (assignment: Assignment) => {
    try {
      await archiveAssignment(assignment.id);
      const today = todayDateString();
      const [assignmentsRes, statsRes] = await Promise.all([
        apiRequest<{ assignments: Assignment[] }>(`/assignments?date=${today}`),
        apiRequest<{ heatmap: DaySummaryResponse[] }>(`/stats/dashboard?from=${today}&to=${today}`)
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove assignment');
    }
  }, []);

  const completed = dayStats?.completed_count ?? 0;
  const total = dayStats?.total_assignments ?? assignments?.length ?? 0;
  const unfinishedAssignments =
    assignments?.filter((a) => a.status === 'pending' || a.status === 'skipped') ?? [];
  const remaining = unfinishedAssignments.length;

  const firstUnfinishedId = unfinishedAssignments[0]?.id;

  return (
    <section>
      <div className="today-header">
        <div>
          <h2>Today</h2>
          <p className="muted">
            {completed}/{total} drilled, {remaining} remaining
          </p>
        </div>
        {firstUnfinishedId ? (
          <Link className="button button-today" to={`/drill/${firstUnfinishedId}?queue_source=today`}>
            Drill
          </Link>
        ) : null}
      </div>
      {error ? <p className="error">{error}</p> : null}
      <AssignmentList
        assignments={assignments ?? []}
        queueSource="today"
        showDrillButton={false}
        variant="today"
        onRemove={handleRemove}
      />
    </section>
  );
}
