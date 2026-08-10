import type { AssignmentStatus } from './enums.js';

/**
 * The day's reorderable work: `pending` and `skipped` assignments (ADR 0008).
 * Completed assignments are fixed anchors and are never reorderable; this is
 * the single shared predicate the api's reorder endpoint and the web's drag
 * surfaces both use.
 */
export function isUnfinishedStatus(status: AssignmentStatus): boolean {
  return status === 'pending' || status === 'skipped';
}

/**
 * Merge a reordered list of a day's unfinished assignments back into the
 * day's full list, leaving every other (completed) item exactly where it is —
 * the anchored merge the reorder endpoint and the client's optimistic update
 * both perform. `items` must contain the same unfinished items as
 * `reorderedUnfinished`, in `reorderedUnfinished`'s order; other items are
 * returned in place.
 */
export function interleaveUnfinished<T extends { id: number; status: AssignmentStatus }>(
  items: readonly T[],
  reorderedUnfinished: readonly T[]
): T[] {
  let unfinishedIndex = 0;
  return items.map((item) =>
    isUnfinishedStatus(item.status) ? reorderedUnfinished[unfinishedIndex++]! : item
  );
}
