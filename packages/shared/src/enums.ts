export const ASSIGNMENT_STATUSES = ['pending', 'completed', 'skipped', 'archived'] as const;
export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

export const ASSIGNMENT_ORIGINS = ['manual', 'anki_rule', 'carryover', 'requeue'] as const;
export type AssignmentOrigin = (typeof ASSIGNMENT_ORIGINS)[number];

export const SOURCE_TYPES = ['manual', 'anki'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const EVENT_TYPES = [
  'added_manual',
  'added_anki',
  'reading_selected',
  'assignment_created',
  'shown',
  'completed',
  'skipped',
  'reopened'
] as const;
export type EventType = (typeof EVENT_TYPES)[number];
