import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type SlowestWordsResponse,
  type TopKanjiResponse,
  type TopWordsResponse
} from '@kanjiscribe/shared';

import { DeltaChip } from '../components/DeltaChip.js';
import { Heatmap } from '../components/Heatmap.js';
import { ProgressCharts } from '../components/ProgressCharts.js';
import { KanjiIcon } from '../components/KanjiIcon.js';
import { LoadingState } from '../components/LoadingState.js';
import { useDashboardStats } from '../hooks/useDashboardStats.js';
import { formatEstimateLabel, useEstimate } from '../hooks/useEstimate.js';
import {
  formatMs,
  formatShortDate,
  getSlowestWords,
  getTopKanji,
  getTopWords,
  todayDateString
} from '../lib/api.js';

export function DashboardPage() {
  const [topWords, setTopWords] = useState<TopWordsResponse | null>(null);
  const [slowestWords, setSlowestWords] = useState<SlowestWordsResponse | null>(null);
  const [topKanji, setTopKanji] = useState<TopKanjiResponse | null>(null);
  const [topWordsError, setTopWordsError] = useState<string | null>(null);
  const [slowestWordsError, setSlowestWordsError] = useState<string | null>(null);
  const [topKanjiError, setTopKanjiError] = useState<string | null>(null);
  const [yearOffset, setYearOffset] = useState(0);
  const todayEstimate = useEstimate('today');
  const backlogEstimate = useEstimate('backlog-days');

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

  const { data, error } = useDashboardStats(range.from, range.to, 'Failed to load dashboard');

  useEffect(() => {
    getTopWords()
      .then(setTopWords)
      .catch((err) => setTopWordsError(err instanceof Error ? err.message : 'Failed to load top words'));
    getSlowestWords()
      .then(setSlowestWords)
      .catch((err) => setSlowestWordsError(err instanceof Error ? err.message : 'Failed to load slowest words'));
    getTopKanji()
      .then(setTopKanji)
      .catch((err) => setTopKanjiError(err instanceof Error ? err.message : 'Failed to load top kanji'));
  }, []);

  if (error) {
    return <p className="error">{error}</p>;
  }

  const hasTodayQueue = (data?.today.pending ?? 0) > 0;
  const hasBacklog = (data?.overdue.incomplete_days ?? 0) > 0;
  // Server-gated day verdict: only the dashboard row for today, and only when
  // the server returned a non-null `estimate_delta_ms` (today is strictly
  // fully completed with full snapshot coverage).
  const todayDeltaMs = data?.heatmap.find((d) => d.date === todayDateString())?.estimate_delta_ms ?? null;
  const todayEstimateLabel = formatEstimateLabel(todayEstimate);
  const backlogEstimateLabel = formatEstimateLabel(backlogEstimate);

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

      {data ? (
        <div className="dashboard-grid">
          <article className="card stat-card">
            <h2>Today</h2>
            <p>{data.today.total} assignments</p>
            <small>
              {data.today.completed} completed, {data.today.pending} remaining
            </small>
            <small>
              Estimate: {todayEstimateLabel}
            </small>
          </article>
          <article className="card stat-card">
            <h2>Overdue</h2>
            <p>{data.overdue.total_pending} open</p>
            <small>Oldest: {data.overdue.oldest_date ? formatShortDate(data.overdue.oldest_date) : 'none'}</small>
            <small>Estimate: {backlogEstimateLabel}</small>
          </article>
          <article className="card stat-card">
            <h2>Today Time</h2>
            <p>{formatMs(data.today.total_time_ms)}</p>
            <small>Average: {formatMs(data.today.avg_time_per_assignment_ms)}</small>
            {todayDeltaMs !== null && (
              <small>
                Day verdict: <DeltaChip deltaMs={todayDeltaMs} />
              </small>
            )}
          </article>
        </div>
      ) : (
        <LoadingState message="Loading dashboard..." />
      )}

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
        {data ? (
          <Heatmap days={data.heatmap} from={range.from} to={range.to} />
        ) : (
          <LoadingState message="Loading heatmap..." />
        )}
      </article>

      <ProgressCharts />

      <div className="reporting-grid">
        <article className="card section-card">
          <h2>Most Drilled Words</h2>
          {topWordsError ? (
            <p className="error">{topWordsError}</p>
          ) : topWords === null ? (
            <LoadingState message="Loading..." />
          ) : topWords.words.length ? (
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
          {slowestWordsError ? (
            <p className="error">{slowestWordsError}</p>
          ) : slowestWords === null ? (
            <LoadingState message="Loading..." />
          ) : slowestWords.words.length ? (
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
          {topKanjiError ? (
            <p className="error">{topKanjiError}</p>
          ) : topKanji === null ? (
            <LoadingState message="Loading..." />
          ) : topKanji.kanji.length ? (
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
