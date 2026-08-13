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

/**
 * Resolve a drag-and-drop within a day's list: `activeId` dropped onto
 * `overId` reorders the day's unfinished items around the completed anchors
 * (ADR 0008 anchored merge). Dropping onto a completed anchor places the
 * dragged item on the far side of it: below when dragged down from above,
 * above when dragged up from below. Returns the reordered full list, or null
 * when the drop changes nothing (same position, unknown ids, or a completed
 * item being dragged).
 */
export function reorderOnDrop<T extends { id: number; status: AssignmentStatus }>(
  items: readonly T[],
  activeId: number,
  overId: number
): T[] | null {
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const overIndex = items.findIndex((item) => item.id === overId);
  if (activeIndex < 0 || overIndex < 0 || !isUnfinishedStatus(items[activeIndex]!.status)) {
    return null;
  }

  const unfinishedItems = items.filter((item) => isUnfinishedStatus(item.status));
  const activeUnfinishedIndex = unfinishedItems.findIndex((item) => item.id === activeId);

  let targetUnfinishedIndex: number;
  if (isUnfinishedStatus(items[overIndex]!.status)) {
    targetUnfinishedIndex = unfinishedItems.findIndex((item) => item.id === overId);
  } else {
    const unfinishedBeforeAnchor = items
      .slice(0, overIndex)
      .filter((item) => isUnfinishedStatus(item.status)).length;
    const draggedFromAbove = activeIndex < overIndex;
    targetUnfinishedIndex = draggedFromAbove
      ? unfinishedBeforeAnchor
      : Math.max(0, unfinishedBeforeAnchor - 1);
  }

  if (activeUnfinishedIndex < 0 || activeUnfinishedIndex === targetUnfinishedIndex) {
    return null;
  }

  const reorderedUnfinished = [...unfinishedItems];
  const [moved] = reorderedUnfinished.splice(activeUnfinishedIndex, 1);
  reorderedUnfinished.splice(targetUnfinishedIndex, 0, moved!);
  return interleaveUnfinished(items, reorderedUnfinished);
}
