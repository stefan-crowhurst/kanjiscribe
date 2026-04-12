import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import { apiRequest, formatMs, formatShortDate } from '../lib/api.js';

type ChartDay = {
  date: string;
  total_assignments: number;
  completed_count: number;
  pending_count: number;
  skipped_count: number;
  total_time_ms: number;
  is_fully_completed: boolean;
};

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
  heatmap: ChartDay[];
};

type TimeInterval = 7 | 14 | 30;

type TimeChartData = {
  shortDate: string;
  fullDate: string;
  totalTimeMin: number;
  totalTimeMs: number;
};

type WordsChartData = {
  shortDate: string;
  fullDate: string;
  wordsCompleted: number;
};

type AvgChartData = {
  shortDate: string;
  fullDate: string;
  avgTimeMin: number;
  avgTimeMs: number;
};

function formatShortDay(dateStr: string): string {
  return dateStr.slice(8, 10) + '/' + dateStr.slice(5, 7);
}

function formatYAxisMinutes(value: number): string {
  if (value === Math.floor(value)) {
    return `${value}min`;
  }
  return '';
}

function formatYAxisAvg(value: number): string {
  if (value === Math.floor(value)) {
    return `${value}min`;
  }
  if (value * 2 === Math.floor(value * 2)) {
    return `${value}min`;
  }
  return '';
}

function TimeTooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ payload: TimeChartData }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-date">{d.fullDate}</p>
      <p>Total time: {formatMs(d.totalTimeMs)}</p>
    </div>
  );
}

function WordsTooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ payload: WordsChartData }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-date">{d.fullDate}</p>
      <p>{d.wordsCompleted} {d.wordsCompleted === 1 ? 'word' : 'words'} completed</p>
    </div>
  );
}

function AvgTooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ payload: AvgChartData }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <p className="chart-tooltip-date">{d.fullDate}</p>
      <p>Avg time: {formatMs(d.avgTimeMs)}</p>
    </div>
  );
}

export function ProgressCharts() {
  const [intervalDays, setIntervalDays] = useState<TimeInterval>(7);
  const [pageOffset, setPageOffset] = useState(0);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    const toDate = new Date();
    toDate.setUTCDate(toDate.getUTCDate() - pageOffset * intervalDays);
    toDate.setUTCHours(0, 0, 0, 0);

    const fromDate = new Date(toDate);
    fromDate.setUTCDate(fromDate.getUTCDate() - (intervalDays - 1));

    return {
      from: fromDate.toISOString().slice(0, 10),
      to: toDate.toISOString().slice(0, 10)
    };
  }, [pageOffset, intervalDays]);

  useEffect(() => {
    apiRequest<DashboardResponse>(`/stats/dashboard?from=${range.from}&to=${range.to}`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load charts'));
  }, [range.from, range.to]);

  const activeDays = useMemo(() => {
    if (!data) return [];
    return data.heatmap.filter((day) => day.total_time_ms > 0 || day.completed_count > 0);
  }, [data]);

  const timeChartData: TimeChartData[] = useMemo(() => {
    if (!activeDays.length) return [];
    return activeDays.map((day) => ({
      shortDate: formatShortDay(day.date),
      fullDate: formatShortDate(day.date),
      totalTimeMin: Math.round(day.total_time_ms / 60000),
      totalTimeMs: day.total_time_ms
    }));
  }, [activeDays]);

  const wordsChartData: WordsChartData[] = useMemo(() => {
    if (!activeDays.length) return [];
    return activeDays.map((day) => ({
      shortDate: formatShortDay(day.date),
      fullDate: formatShortDate(day.date),
      wordsCompleted: day.completed_count
    }));
  }, [activeDays]);

  const avgChartData: AvgChartData[] = useMemo(() => {
    if (!activeDays.length) return [];
    return activeDays
      .filter((day) => day.completed_count > 0)
      .map((day) => ({
        shortDate: formatShortDay(day.date),
        fullDate: formatShortDate(day.date),
        avgTimeMin: Math.round((day.total_time_ms / day.completed_count / 60000) * 10) / 10,
        avgTimeMs: day.total_time_ms / day.completed_count
      }));
  }, [activeDays]);

  const handleIntervalChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setIntervalDays(Number(e.target.value) as TimeInterval);
    setPageOffset(0);
  };

  const goBack = () => setPageOffset((v) => v + 1);
  const goForward = () => setPageOffset((v) => Math.max(0, v - 1));

  const maxTimeMin = useMemo(() => {
    if (!timeChartData.length) return 5;
    const max = Math.max(...timeChartData.map((d) => d.totalTimeMin));
    return Math.max(max, 1);
  }, [timeChartData]);

  const maxWords = useMemo(() => {
    if (!wordsChartData.length) return 5;
    const max = Math.max(...wordsChartData.map((d) => d.wordsCompleted));
    return Math.max(max, 1);
  }, [wordsChartData]);

  const maxAvgMin = useMemo(() => {
    if (!avgChartData.length) return 5;
    const max = Math.max(...avgChartData.map((d) => d.avgTimeMin));
    return Math.max(max, 0.5);
  }, [avgChartData]);

  const timeTicks = useMemo(() => {
    const step = maxTimeMin <= 5 ? 0.5 : 1;
    const ticks: number[] = [];
    for (let v = 0; v <= maxTimeMin + step; v += step) {
      ticks.push(Math.round(v * 10) / 10);
    }
    return ticks;
  }, [maxTimeMin]);

  const wordsTicks = useMemo(() => {
    const ticks: number[] = [];
    for (let v = 0; v <= maxWords; v++) {
      ticks.push(v);
    }
    return ticks;
  }, [maxWords]);

  const avgTicks = useMemo(() => {
    const step = maxAvgMin <= 2 ? 0.5 : 1;
    const ticks: number[] = [];
    for (let v = 0; v <= maxAvgMin + step; v += step) {
      ticks.push(Math.round(v * 10) / 10);
    }
    return ticks;
  }, [maxAvgMin]);

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!data) {
    return <p className="muted">Loading charts...</p>;
  }

  return (
    <article className="card section-card">
      <div className="heatmap-heading">
        <div>
          <h2>Per-day Stats</h2>
        </div>
        <div className="heatmap-controls">
          <select className="chart-interval-select" value={intervalDays} onChange={handleIntervalChange}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={30}>30 days</option>
          </select>
          <span className="muted">
            {formatShortDate(range.from)} to {formatShortDate(range.to)}
          </span>
          <div className="heatmap-nav-group">
            <button className="heatmap-nav" onClick={goBack} aria-label="Previous period">
              ←
            </button>
            <button
              className="heatmap-nav"
              onClick={goForward}
              disabled={pageOffset === 0}
              aria-label="Next period"
            >
              →
            </button>
          </div>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-container">
          <h3>Total Time</h3>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={timeChartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4d4c2" />
              <XAxis dataKey="shortDate" tick={{ fontSize: 11, fill: '#766958' }} />
              <YAxis width={36} ticks={timeTicks} tickFormatter={formatYAxisMinutes} tick={{ fontSize: 11, fill: '#766958' }} />
              <Tooltip content={<TimeTooltipContent />} />
              <Bar dataKey="totalTimeMin" fill="#d7b9a1" radius={[2, 2, 0, 0]} />
              <Line type="monotone" dataKey="totalTimeMin" stroke="#9b2f2f" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h3>Words Completed</h3>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={wordsChartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4d4c2" />
              <XAxis dataKey="shortDate" tick={{ fontSize: 11, fill: '#766958' }} />
              <YAxis width={36} ticks={wordsTicks} allowDecimals={false} tick={{ fontSize: 11, fill: '#766958' }} />
              <Tooltip content={<WordsTooltipContent />} />
              <Bar dataKey="wordsCompleted" fill="#3b7f5f" fillOpacity={0.35} radius={[2, 2, 0, 0]} />
              <Line type="monotone" dataKey="wordsCompleted" stroke="#3b7f5f" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-container">
          <h3>Avg Time per Word</h3>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart data={avgChartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e4d4c2" />
              <XAxis dataKey="shortDate" tick={{ fontSize: 11, fill: '#766958' }} />
              <YAxis width={36} ticks={avgTicks} tickFormatter={formatYAxisAvg} tick={{ fontSize: 11, fill: '#766958' }} />
              <Tooltip content={<AvgTooltipContent />} />
              <Bar dataKey="avgTimeMin" fill="#b06f2c" fillOpacity={0.35} radius={[2, 2, 0, 0]} />
              <Line type="monotone" dataKey="avgTimeMin" stroke="#b06f2c" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </article>
  );
}