import { useState, type ReactNode } from 'react';
import type { Assignment } from '@kanjiscribe/shared';
import { interleaveUnfinished, isUnfinishedStatus } from '@kanjiscribe/shared';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type UniqueIdentifier
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';

export type SortableAssignment = ReturnType<typeof useSortable>;

export function ReorderableAssignmentList({
  assignments,
  onReorder,
  isReordering,
  renderItem,
  renderOverlay,
  className = 'assignment-list'
}: {
  assignments: Assignment[];
  onReorder: (assignments: Assignment[]) => void;
  isReordering: boolean;
  renderItem: (assignment: Assignment, sortable: SortableAssignment) => ReactNode;
  renderOverlay: (assignment: Assignment) => ReactNode;
  className?: string;
}) {
  const [activeId, setActiveId] = useState<UniqueIdentifier | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } })
  );

  function handleDragEnd({ active, over }: DragEndEvent) {
    setActiveId(null);
    if (isReordering || !over || active.id === over.id) {
      return;
    }

    const activeIndex = findAssignmentIndex(assignments, active.id);
    const overIndex = findAssignmentIndex(assignments, over.id);
    if (activeIndex < 0 || overIndex < 0 || !isUnfinishedStatus(assignments[activeIndex]!.status)) {
      return;
    }

    const unfinishedAssignments = assignments.filter((assignment) =>
      isUnfinishedStatus(assignment.status)
    );
    const activeUnfinishedIndex = unfinishedAssignments.findIndex(
      (assignment) => assignment.id === assignments[activeIndex]!.id
    );
    let targetUnfinishedIndex: number;

    if (isUnfinishedStatus(assignments[overIndex]!.status)) {
      targetUnfinishedIndex = unfinishedAssignments.findIndex(
        (assignment) => assignment.id === assignments[overIndex]!.id
      );
    } else {
      const unfinishedBeforeAnchor = assignments
        .slice(0, overIndex)
        .filter((assignment) => isUnfinishedStatus(assignment.status)).length;
      // Dropping onto a completed anchor places the dragged assignment on the
      // far side of it: below when dragged down from above, above when
      // dragged up from below — the anchored merge (ADR 0008).
      const draggedFromAbove = activeIndex < overIndex;
      targetUnfinishedIndex = draggedFromAbove
        ? unfinishedBeforeAnchor
        : Math.max(0, unfinishedBeforeAnchor - 1);
    }

    if (activeUnfinishedIndex < 0 || activeUnfinishedIndex === targetUnfinishedIndex) {
      return;
    }

    const reorderedUnfinished = arrayMove(
      unfinishedAssignments,
      activeUnfinishedIndex,
      targetUnfinishedIndex
    );
    onReorder(interleaveUnfinished(assignments, reorderedUnfinished));
  }

  const activeAssignment =
    activeId === null
      ? null
      : assignments.find((assignment) => assignment.id.toString() === activeId.toString());

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setActiveId(active.id)}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={assignments.map((assignment) => assignment.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className={className}>
          {assignments.map((assignment) => (
            <SortableAssignmentItem
              key={assignment.id}
              assignment={assignment}
              disabled={
                isUnfinishedStatus(assignment.status)
                  ? isReordering
                  : { draggable: true, droppable: false }
              }
              render={renderItem}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>{activeAssignment ? renderOverlay(activeAssignment) : null}</DragOverlay>
    </DndContext>
  );
}

function SortableAssignmentItem({
  assignment,
  disabled,
  render
}: {
  assignment: Assignment;
  disabled: boolean | { draggable?: boolean; droppable?: boolean };
  render: (assignment: Assignment, sortable: SortableAssignment) => ReactNode;
}) {
  const sortable = useSortable({ id: assignment.id, disabled });
  return render(assignment, sortable);
}

export function AssignmentDragHandle({
  sortable,
  label,
  disabled
}: {
  sortable: SortableAssignment;
  label: string;
  disabled: boolean;
}) {
  const { attributes, listeners, setActivatorNodeRef } = sortable;

  return (
    <button
      ref={setActivatorNodeRef}
      type="button"
      className="assignment-drag-handle"
      aria-label={label}
      title="Drag to reorder"
      disabled={disabled}
      {...attributes}
      {...listeners}
      onClick={(event) => event.stopPropagation()}
    >
      <span className="assignment-drag-grip" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <span />
      </span>
    </button>
  );
}

function findAssignmentIndex(assignments: Assignment[], id: UniqueIdentifier): number {
  return assignments.findIndex((assignment) => assignment.id.toString() === id.toString());
}

function arrayMove<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
