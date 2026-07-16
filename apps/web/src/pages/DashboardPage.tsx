import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Heatmap } from '../components/Heatmap.js';
import { ProgressCharts } from '../components/ProgressCharts.js';
import { KanjiIcon } from '../components/KanjiIcon.js';
import { apiRequest, formatMs, formatMsEstimate, formatShortDate } from '../lib/api.js';

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

type TopWordsResponse = {
  words: Array<{
    study_item_id: number;
    surface_form: string;
    selected_reading: string;
    times_completed: number;
    total_time_ms: number;
    avg_completion_time_ms: number;
  }>;
};

type SlowestWordsResponse = {
  words: Array<{
    study_item_id: number;
    surface_form: string;
    selected_reading: string;
    times_completed: number;
    total_time_ms: number;
    avg_completion_time_ms: number;
  }>;
};

type TopKanjiResponse = {
  kanji: Array<{
    literal: string;
    word_count: number;
    total_assignments: number;
    times_drilled: number;
    onyomi: string[];
    kunyomi: string[];
    stroke_count: number;
    grade: number | null;
  }>;
};

type TodayEstimateResponse = {
  estimated_remaining_ms: number;
};

export function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [topWords, setTopWords] = useState<TopWordsResponse | null>(null);
  const [slowestWords, setSlowestWords] = useState<SlowestWordsResponse | null>(null);
  const [topKanji, setTopKanji] = useState<TopKanjiResponse | null>(null);
  const [todayEstimate, setTodayEstimate] = useState<number | null>(null);
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

  useEffect(() => {
    apiRequest<TodayEstimateResponse>('/estimates/today')
      .then((res) => setTodayEstimate(res.estimated_remaining_ms))
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      apiRequest<TopWordsResponse>('/stats/top-words'),
      apiRequest<SlowestWordsResponse>('/stats/slowest-words'),
      apiRequest<TopKanjiResponse>('/stats/top-kanji')
    ])
      .then(([top, slowest, kanji]) => {
        setTopWords(top);
        setSlowestWords(slowest);
        setTopKanji(kanji);
      })
      .catch(() => {});
  }, []);

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
            {data.today.completed} completed, {data.today.pending} remaining
          </small>
          <small>
            Estimate: {todayEstimate === null ? '—' : formatMsEstimate(todayEstimate)}
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
          <div>
            <h2>Progress Heatmap</h2>
            <p className="muted">Click any day with activity to view assignment details</p>
          </div>
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

      <ProgressCharts />

      <div className="reporting-grid">
        <article className="card section-card">
          <h2>Most Drilled Words</h2>
          {topWords?.words.length ? (
            <ol className="reporting-list">
              {topWords.words.map((word) => (
                <li key={word.study_item_id}>
                  <span className="reporting-word">
                    <strong>{word.surface_form}</strong>
                    <span className="reporting-reading">{word.selected_reading}</span>
                  </span>
                  <span className="reporting-stat">
                    {word.times_completed}× completed
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">No words drilled yet.</p>
          )}
        </article>

        <article className="card section-card">
          <h2>Slowest Words</h2>
          {slowestWords?.words.length ? (
            <ol className="reporting-list">
              {slowestWords.words.map((word) => (
                <li key={word.study_item_id}>
                  <span className="reporting-word">
                    <strong>{word.surface_form}</strong>
                    <span className="reporting-reading">{word.selected_reading}</span>
                  </span>
                  <span className="reporting-stat">
                    avg {formatMs(word.avg_completion_time_ms)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">Need at least 2 completions per word.</p>
          )}
        </article>

        <article className="card section-card">
          <h2>Most Drilled Kanji</h2>
          {topKanji?.kanji.length ? (
            <ol className="reporting-list">
              {topKanji.kanji.map((k) => {
                const readings = [k.onyomi[0], k.kunyomi[0]].filter(Boolean);
                return (
                  <li key={k.literal}>
                    <span className="reporting-kanji">
                      <strong className="reporting-kanji-literal">{k.literal}</strong>
                      <span className="reporting-kanji-meanings">
                        {readings.join(', ') || '-'}
                      </span>
                    </span>
                    <span className="reporting-stat">
                      {k.times_drilled}× drilled
                    </span>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="muted">No kanji drilled yet.</p>
          )}
        </article>
      </div>
    </section>
  );
}
