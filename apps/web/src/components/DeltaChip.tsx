import { formatMs } from '../lib/api.js';

/**
 * Estimate delta indicator (see CONTEXT.md: estimate delta).
 *
 * The single shared renderer for all performance-vs-estimate surfaces:
 * per-word chips on the day detail page, the day-level verdict (day detail
 * header, Today Time card, Today page), and the heatmap tooltip.
 *
 * - Positive delta (over estimate / slower) → up arrow, red
 * - Negative delta (under estimate / faster) → down arrow, green
 * - Exact zero → neutral muted "±0:00", no arrow
 */
export function DeltaChip({ deltaMs }: { deltaMs: number }) {
  if (deltaMs === 0) {
    return (
      <span className="delta-chip delta-chip--neutral" aria-label="on estimate">
        ±0:00
      </span>
    );
  }

  const over = deltaMs > 0;
  const arrow = over ? '↑' : '↓';
  const sign = over ? '+' : '−';

  return (
    <span
      className={`delta-chip ${over ? 'delta-chip--over' : 'delta-chip--under'}`}
      aria-label={`${formatMs(Math.abs(deltaMs))} ${over ? 'over' : 'under'} estimate`}
    >
      {arrow} {sign}
      {formatMs(Math.abs(deltaMs))}
    </span>
  );
}
