import { DeltaChip } from './DeltaChip.js';

/**
 * Shared day verdict block (see CONTEXT.md: day estimate delta).
 *
 * The single renderer for the day-level verdict on Today, Day detail, and the
 * dashboard's Today Time card, so a day's overall performance reads the same
 * wherever it appears. Renders `Day verdict: <chip>` on its own line, and only
 * when the server supplied a day estimate delta.
 *
 * The "is this day final?" gate — strictly fully completed with full snapshot
 * coverage — lives on the server (`v_day_summary`); it is deliberately not
 * duplicated here. `undefined` is accepted for callers whose request has not
 * returned yet, and reads the same as `null` (no verdict).
 *
 * `className` lets a surface adjust the presentation without forking the
 * block's copy or structure — the Dashboard uses it to keep its compact,
 * muted stat-card treatment.
 */
export function DayVerdict({
  deltaMs,
  className = ''
}: {
  deltaMs: number | null | undefined;
  className?: string;
}) {
  if (deltaMs === null || deltaMs === undefined) {
    return null;
  }

  return (
    <p className={`day-verdict ${className}`.trim()}>
      Day verdict: <DeltaChip deltaMs={deltaMs} />
    </p>
  );
}
