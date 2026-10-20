import type { Assignment } from '@kanjiscribe/shared';

/**
 * Queue a drill opened from a backing list view runs through. ADR-0007 sends
 * completed assignments to the word view and unfinished ones to the drill;
 * the queue only matters for the drill branch.
 */
export type DrillQueueSource = 'today' | 'backlog';

export interface AssignmentCardUrlOptions {
  /**
   * Queue this surface's drill runs through, rendered as
   * `?queue_source={source}` when no `drillQuery` is supplied.
   */
  queueSource?: DrillQueueSource;
  /**
   * The drill query this surface's cards share, including its leading `?`.
   * The Backlog supplies its full per-day queue this way, and it takes
   * precedence over `queueSource`; Today relies on `queueSource` alone.
   */
  drillQuery?: string;
  /**
   * Completed ids the word view pages through (previous/next). Only Day
   * detail supplies these; Today deliberately omits them, so the ids appear
   * only when the list is non-empty.
   */
  completedIds?: readonly number[];
}

/**
 * Resolves where an assignment card goes, for every backing list view. A
 * completed assignment opens the word view for its own assigned day; a
 * pending or skipped one opens the drill with the caller's queue query.
 *
 * Navigation behaviour is unchanged by this helper; it only centralises the
 * two-branch decision (ADR-0007) that each surface used to repeat.
 */
export function assignmentCardUrl(
  assignment: Assignment,
  { queueSource, drillQuery, completedIds }: AssignmentCardUrlOptions = {}
): string {
  if (assignment.status === 'completed') {
    return wordViewUrl(assignment, completedIds);
  }

  return drillUrl(assignment, drillQuery ?? queueSourceQuery(queueSource));
}

function wordViewUrl(assignment: Assignment, completedIds?: readonly number[]): string {
  const viewUrl = `/word/${assignment.id}?day=${assignment.assigned_for_date}`;
  return completedIds && completedIds.length > 0
    ? `${viewUrl}&ids=${completedIds.join(',')}`
    : viewUrl;
}

function drillUrl(assignment: Assignment, query: string): string {
  return `/drill/${assignment.id}${query}`;
}

function queueSourceQuery(queueSource?: DrillQueueSource): string {
  return queueSource ? `?queue_source=${queueSource}` : '';
}
