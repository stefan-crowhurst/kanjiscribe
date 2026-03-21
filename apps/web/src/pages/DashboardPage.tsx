import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Heatmap } from '../components/Heatmap.js';
import { KanjiIcon } from '../components/KanjiIcon.js';
import { apiRequest, formatMs, formatShortDate } from '../lib/api.js';

type DashboardResponse = {
  today: {
    total: number;
    pending: number;
    completed: number;
    total_time_ms: number;
    avg_time_per_assignment_ms: number;
  };
  overdue: { total_pending: number; incomplete_days: number; oldest_date: string | null };
  totals: { total_time_ms: number; total_completed: number; avg_time_per_assignment_ms: number };
  heatmap: Array<{
    date: string;
    total_assignments: number;
    completed_count: number;
    pending_count: number;
    skipped_count: number;
    total_time_ms: number;
    is_fully_completed: boolean;
  }>;
};

export function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [yearOffset, setYearOffset] = useState(0);

  const range = useMemo(() => {
    const toDate = new Date();
    toDate.setUTCDate(toDate.getUTCDate() - yearOffset * 365);

    const fromDate = new Date(toDate);
    fromDate.setUTCDate(fromDate.getUTCDate() - 364);

    return {
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10)
    };
  }, [yearOffset]);

  useEffect(() => {
    apiRequest<DashboardResponse>(`/stats/dashboard?from=${range.from}&to=${range.to}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load dashboard'));
  }, [range.from, range.to]);

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!data) {
    return <p className="muted">Loading dashboard...</p>;
  }

  const hasTodayQueue = data.today.pending > 0;
  const hasBacklog = data.overdue.incomplete_days > 0;

  return (
    <section>
      <div className="dashboard-links dashboard-links-top" role="navigation" aria-label="Dashboard quick actions">
        <Link className="button button-intake" to="/intake">
          <KanjiIcon literal="新" className="action-kanji" />
          <span>Add Word</span>
        </Link>
        <Link className={`button ${hasTodayQueue ? 'button-today' : 'button-today-outline'}`} to="/today">
          <KanjiIcon literal="今" className="action-kanji" />
          <span>Open Today Queue</span>
        </Link>
        <Link className={`button ${hasBacklog ? 'button-backlog-filled' : 'button-backlog'}`} to="/backlog">
          <KanjiIcon literal="残" className="action-kanji" />
          <span>Open Backlog</span>
        </Link>
      </div>

      <div className="dashboard-grid">
        <article className="card stat-card">
          <h2>Today</h2>
          <p>{data.today.total} assignments</p>
          <small>
            {data.today.completed} completed, {data.today.pending} pending
          </small>
        </article>
        <article className="card stat-card">
          <h2>Overdue</h2>
          <p>{data.overdue.total_pending} open</p>
          <small>Oldest: {data.overdue.oldest_date ? formatShortDate(data.overdue.oldest_date) : 'none'}</small>
        </article>
        <article className="card stat-card">
          <h2>Today Time</h2>
          <p>{formatMs(data.today.total_time_ms)}</p>
          <small>Average: {formatMs(data.today.avg_time_per_assignment_ms)}</small>
        </article>
      </div>

      <article className="card section-card">
        <div className="heatmap-heading">
          <h2>Progress Heatmap</h2>
          <div className="heatmap-controls">
            <span className="muted">
              {formatShortDate(range.from)} to {formatShortDate(range.to)}
            </span>
            <div className="heatmap-nav-group">
              <button className="heatmap-nav" onClick={() => setYearOffset((value) => value + 1)} aria-label="Previous year">
                ←
              </button>
              <button
                className="heatmap-nav"
                onClick={() => setYearOffset((value) => Math.max(0, value - 1))}
                disabled={yearOffset === 0}
                aria-label="Next year"
              >
                →
              </button>
            </div>
          </div>
        </div>
        <Heatmap days={data.heatmap} from={range.from} to={range.to} />
      </article>
    </section>
  );
}
