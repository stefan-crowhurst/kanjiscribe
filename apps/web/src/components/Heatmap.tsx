import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type HeatmapDay = {
  date: string;
  total_assignments: number;
  completed_count: number;
  pending_count: number;
  skipped_count: number;
  total_time_ms: number;
  is_fully_completed: boolean;
};

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function formatLongDate(date: Date): string {
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date);
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(date.getUTCFullYear()).slice(-2);
  return `${dayName} ${dd}/${mm}/${yy}`;
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function getTone(day: HeatmapDay | undefined, maxCompleted: number): string {
  if (!day) {
    return 'none';
  }

  if (day.pending_count > 0) {
    return 'pending';
  }

  if (day.skipped_count > 0 && day.completed_count === 0) {
    return 'skipped';
  }

  if (day.completed_count <= 0 || !day.is_fully_completed) {
    return 'none';
  }

  const level = Math.max(1, Math.ceil((day.completed_count / Math.max(maxCompleted, 1)) * 4));
  return `done-${Math.min(level, 4)}`;
}

export function Heatmap({ days, from, to }: { days: HeatmapDay[]; from: string; to: string }) {
  const [hoverDate, setHoverDate] = useState<string | null>(null);
  const [pinnedDate, setPinnedDate] = useState<string | null>(null);
  const [tooltipAnchor, setTooltipAnchor] = useState<{ x: number; y: number; placeAbove: boolean } | null>(null);
  const navigate = useNavigate();
  const scrollRef = useRef<HTMLDivElement>(null);

  const byDate = new Map(days.map((day) => [day.date, day]));
  const maxCompleted = days.reduce((max, day) => Math.max(max, day.completed_count), 0);
  const activeDate = pinnedDate ?? hoverDate;

  const start = parseDate(from);
  const end = parseDate(to);

  const gridStart = new Date(start);
  const startWeekdayMonFirst = (gridStart.getUTCDay() + 6) % 7;
  gridStart.setUTCDate(gridStart.getUTCDate() - startWeekdayMonFirst);

  const gridEnd = new Date(end);
  const endWeekdayMonFirst = (gridEnd.getUTCDay() + 6) % 7;
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - endWeekdayMonFirst));

  const allDates: Date[] = [];
  for (let cursor = new Date(gridStart); cursor <= gridEnd; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    allDates.push(new Date(cursor));
  }

  const totalWeeks = Math.ceil(allDates.length / 7);
  const columnWidth = 12;
  const columnGap = 4;
  const heatmapGridWidth = totalWeeks * columnWidth + (totalWeeks - 1) * columnGap;

  const monthMarkers = new Map<number, { label: string; offset?: number }>();
  const monthPositions: Array<{ weekIndex: number; monthIndex: number }> = [];
  
  // First pass: collect all month positions
  allDates.forEach((date, index) => {
    if (date.getUTCDate() === 1 || index === 0) {
      const weekIndex = Math.floor(index / 7);
      monthPositions.push({ weekIndex, monthIndex: date.getUTCMonth() });
    }
  });
  
  // Second pass: add markers with offsets for close months
  // Skip the last month if it's in the final week to prevent overflow
  monthPositions.forEach((pos, i) => {
    // Skip last month if it's in the final week of the grid
    if (i === monthPositions.length - 1 && pos.weekIndex >= totalWeeks - 1) {
      return;
    }
    
    let offset = 0;
    // Check if previous month is within 2 weeks
    if (i > 0) {
      const prevPos = monthPositions[i - 1];
      if (prevPos && pos.weekIndex - prevPos.weekIndex <= 2) {
        // Only add offset if this isn't the last month (to prevent overflow)
        if (i < monthPositions.length - 1) {
          offset = 12; // Offset by ~1.5 column widths
        }
      }
    }
    monthMarkers.set(pos.weekIndex, { label: MONTH_LABELS[pos.monthIndex] ?? '?', offset });
  });

  const activeDay = activeDate ? byDate.get(activeDate) : undefined;
  const activeDateLabel = activeDate ? formatLongDate(parseDate(activeDate)) : null;

  const setTooltipFromCell = (cell: HTMLButtonElement) => {
    const rect = cell.getBoundingClientRect();
    const placeAbove = rect.top > 120;
    const tooltipHalfWidth = 140;
    const edgePadding = 10;
    const unclampedX = rect.left + rect.width / 2;
    const clampedX = Math.max(
      edgePadding + tooltipHalfWidth,
      Math.min(window.innerWidth - edgePadding - tooltipHalfWidth, unclampedX)
    );

    setTooltipAnchor({
      x: clampedX,
      y: placeAbove ? rect.top - 8 : rect.bottom + 8,
      placeAbove
    });
  };

  const tooltipSummary = useMemo(() => {
    if (!activeDate || !activeDateLabel) {
      return null;
    }

    if (!activeDay) {
      return {
        title: 'No drills completed',
        subtitle: activeDateLabel,
        detail: null as string | null
      };
    }

    if (activeDay.completed_count > 0) {
      const noun = activeDay.completed_count === 1 ? 'word drilled' : 'words drilled';
      return {
        title: `${activeDay.completed_count} ${noun}`,
        subtitle: activeDateLabel,
        detail: `in ${formatDuration(activeDay.total_time_ms)}`
      };
    }

    if (activeDay.pending_count > 0 || activeDay.skipped_count > 0) {
      return {
        title: `${activeDay.total_assignments} assigned (${activeDay.pending_count} pending, ${activeDay.skipped_count} skipped)`,
        subtitle: activeDateLabel,
        detail: activeDay.total_time_ms > 0 ? `in ${formatDuration(activeDay.total_time_ms)}` : null
      };
    }

    return {
      title: 'No drills completed',
      subtitle: activeDateLabel,
      detail: activeDay.total_time_ms > 0 ? `in ${formatDuration(activeDay.total_time_ms)}` : null
    };
  }, [activeDate, activeDateLabel, activeDay]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (target.closest('.heatmap-cell')) {
        return;
      }

      if (pinnedDate) {
        setPinnedDate(null);
      }

      if (!hoverDate) {
        setTooltipAnchor(null);
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [hoverDate, pinnedDate]);

  // Scroll to the end to show most recent activity by default
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, []);

  // Track window width and scroll to end when resizing to smaller screen
  useEffect(() => {
    let lastWidth = window.innerWidth;
    
    const handleResize = () => {
      const currentWidth = window.innerWidth;
      // If window got smaller (like landscape -> portrait), scroll to end
      if (currentWidth < lastWidth && scrollRef.current) {
        scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
      }
      lastWidth = currentWidth;
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="heatmap-chart" aria-label="drill heatmap">
      <div className="heatmap-main">
        <div className="heatmap-weekday-col">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        <div className="heatmap-scroll" role="region" aria-label="Scrollable yearly heatmap" ref={scrollRef}>
          <div className="heatmap-scroll-inner" style={{ width: '100%', minWidth: `${heatmapGridWidth}px` }}>
            <div className="heatmap-month-row" style={{ gridTemplateColumns: `repeat(${totalWeeks}, minmax(12px, 1fr))` }}>
              {Array.from(monthMarkers.entries()).map(([weekIndex, data]) => (
                <span 
                  key={`${weekIndex}-${data.label}`} 
                  style={{ 
                    gridColumnStart: weekIndex + 1,
                    marginLeft: data.offset ? `${data.offset}px` : undefined
                  }}
                >
                  {data.label}
                </span>
              ))}
            </div>

            <div className="heatmap-cells" style={{ gridTemplateColumns: `repeat(${totalWeeks}, minmax(12px, 1fr))` }}>
              {allDates.map((date, index) => {
                const dateString = formatDate(date);
                const day = byDate.get(dateString);
                const tone = getTone(day, maxCompleted);
                const isActive = activeDate === dateString;

                return (
                  <button
                    key={dateString}
                    type="button"
                    className={`heatmap-cell tone-${tone} ${isActive ? 'active' : ''}`}
                    style={{
                      gridColumnStart: Math.floor(index / 7) + 1,
                      gridRowStart: ((date.getUTCDay() + 6) % 7) + 1
                    }}
                    onMouseEnter={(event) => {
                      setHoverDate(dateString);
                      setTooltipFromCell(event.currentTarget);
                    }}
                    onMouseLeave={() => {
                      setHoverDate(null);
                      if (!pinnedDate) {
                        setTooltipAnchor(null);
                      }
                    }}
                    onFocus={(event) => {
                      setHoverDate(dateString);
                      setTooltipFromCell(event.currentTarget);
                    }}
                    onBlur={() => {
                      setHoverDate(null);
                      if (!pinnedDate) {
                        setTooltipAnchor(null);
                      }
                    }}
                    onClick={(event) => {
                      const dayData = byDate.get(dateString);
                      if (dayData && dayData.total_assignments > 0) {
                        navigate(`/day/${dateString}`);
                      } else {
                        setPinnedDate((current) => {
                          const next = current === dateString ? null : dateString;
                          if (!next && !hoverDate) {
                            setTooltipAnchor(null);
                          }
                          return next;
                        });
                        setTooltipFromCell(event.currentTarget);
                      }
                    }}
                    aria-label={`${dateString}: ${day?.completed_count ?? 0} completed, ${day?.pending_count ?? 0} pending`}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {tooltipSummary && tooltipAnchor ? (
        <div
          className={`heatmap-tooltip floating ${tooltipAnchor.placeAbove ? 'above' : 'below'}`}
          role="status"
          aria-live="polite"
          style={{ left: tooltipAnchor.x, top: tooltipAnchor.y }}
        >
          <p>{tooltipSummary.title}</p>
          {tooltipSummary.detail ? <span className="heatmap-tooltip-detail">{tooltipSummary.detail}</span> : null}
          <small>{tooltipSummary.subtitle}</small>
        </div>
      ) : null}
    </div>
  );
}
