import { useState, type ReactNode } from 'react';
import type { Assignment } from '@kanjiscribe/shared';
import { isUnfinishedStatus, reorderOnDrop } from '@kanjiscribe/shared';
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

    const reordered = reorderOnDrop(assignments, Number(active.id), Number(over.id));
    if (reordered) {
      onReorder(reordered);
    }
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
