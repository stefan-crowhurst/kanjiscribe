import {
  intakeRequestSchema,
  isKanjiChar,
  type AssignmentOrigin,
  type AssignmentStatus,
  type IntakeResponse,
  type SourceType
} from '@kanjiscribe/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';

import { unarchiveAssignment } from '../assignments/lifecycle.js';
import { nowIso, todayIsoDate } from '../config.js';
import { sqlite } from '../db/client.js';
import { estimateAssignment } from '../estimates/estimates.js';
import { notFound, parseOr400 } from '../http.js';

/**
 * Intake transaction result. The 200 (unarchive-reactivate) and 201 (fresh
 * assignment) success shapes share one body contract (`IntakeResponse`);
 * the 409 conflict body is the route's own error shape, not a success shape.
 */
type IntakeSuccess = { status: 200 | 201; body: IntakeResponse };
type IntakeConflict = {
  status: 409;
  body: { error: string; assignment: { id: number; status: string; created_at: string } };
};
type IntakeTransactionResult = IntakeSuccess | IntakeConflict;

function intakeSuccessBody(
  studyItem: {
    id: number;
    surface_form: string;
    selected_reading: string;
    dictionary_entry_id: number;
    source_type: SourceType;
    created_at: string;
  },
  assignment: IntakeResponse['assignment'],
  isNew: boolean
): IntakeResponse {
  return {
    study_item: {
      id: studyItem.id,
      surface_form: studyItem.surface_form,
      selected_reading: studyItem.selected_reading,
      dictionary_entry_id: studyItem.dictionary_entry_id,
      source_type: studyItem.source_type,
      created_at: studyItem.created_at,
      is_new: isNew
    },
    assignment
  };
}

function kanjiSvgFilename(char: string): string {
  const codePoint = char.codePointAt(0) ?? 0;
  return codePoint.toString(16).padStart(5, '0').toLowerCase();
}

export function registerIntakeRoutes(app: FastifyInstance): void {
  app.post('/study-items/intake', async (request, reply): Promise<FastifyReply | undefined> => {
    const parsed = parseOr400(intakeRequestSchema, request.body, reply);
    if (parsed === null) {
      return;
    }

    const payload = parsed;
    const now = nowIso();
    const assignedForDate = payload.assigned_for_date ?? todayIsoDate();
    const origin = payload.source_type === 'anki' ? 'anki_rule' : 'manual';

    const dictionaryExists = sqlite
      .prepare('SELECT id FROM dictionary_entry WHERE id = ?')
      .get(payload.dictionary_entry_id) as { id: number } | undefined;

    if (!dictionaryExists) {
      return notFound(reply, 'Dictionary entry not found');
    }

    const transaction = sqlite.transaction((): IntakeTransactionResult => {
      const existing = sqlite
        .prepare(
          `
          SELECT id, surface_form, selected_reading, dictionary_entry_id, source_type, created_at
          FROM study_item
          WHERE surface_form = ? AND selected_reading = ? AND dictionary_entry_id = ?
          `
        )
        .get(
          payload.surface_form,
          payload.selected_reading,
          payload.dictionary_entry_id
        ) as
        | {
            id: number;
            surface_form: string;
            selected_reading: string;
            dictionary_entry_id: number;
            source_type: SourceType;
            created_at: string;
          }
        | undefined;

      let studyItem = existing;
      let isNew = false;

      if (!studyItem) {
        const insertResult = sqlite
          .prepare(
            `
            INSERT INTO study_item (
              surface_form,
              selected_reading,
              dictionary_entry_id,
              source_type,
              created_at
            ) VALUES (?, ?, ?, ?, ?)
            `
          )
          .run(
            payload.surface_form,
            payload.selected_reading,
            payload.dictionary_entry_id,
            payload.source_type,
            now
          );

        const newId = Number(insertResult.lastInsertRowid);
        studyItem = {
          id: newId,
          surface_form: payload.surface_form,
          selected_reading: payload.selected_reading,
          dictionary_entry_id: payload.dictionary_entry_id,
          source_type: payload.source_type,
          created_at: now
        };
        isNew = true;

        const chars = Array.from(payload.surface_form);
        for (let index = 0; index < chars.length; index += 1) {
          const char = chars[index];
          if (!char || !isKanjiChar(char)) {
            continue;
          }

          const inKanjiTable = sqlite
            .prepare('SELECT literal FROM kanji WHERE literal = ?')
            .get(char) as { literal: string } | undefined;

          if (!inKanjiTable) {
            app.log.warn(`Kanji '${char}' (${kanjiSvgFilename(char)}) missing from kanji table`);
            continue;
          }

          sqlite
            .prepare(
              `
              INSERT INTO study_item_kanji (study_item_id, position, kanji_literal)
              VALUES (?, ?, ?)
              `
            )
            .run(newId, index, char);
        }
      }

      // Check if an assignment already exists for this study item and date
      const existingAssignment = sqlite
        .prepare(
          `
          SELECT id, status, created_at
          FROM daily_assignment
          WHERE study_item_id = ? AND assigned_for_date = ?
          `
        )
        .get(studyItem.id, assignedForDate) as {
        id: number;
        status: string;
        created_at: string;
      } | undefined;

      if (existingAssignment) {
        if (existingAssignment.status === 'archived') {
          // Re-adding a previously-removed word: unarchive it instead of erroring.
          // Called from inside this transaction (better-sqlite3 nests via
          // savepoints). The estimate snapshot is NOT (re)written here — the
          // row keeps whatever `estimated_ms` it already has (NULL for
          // pre-feature rows), per the estimate-snapshot contract in
          // CONTEXT.md.
          unarchiveAssignment(sqlite, existingAssignment.id);

          const assignment = sqlite
            .prepare(
              `
              SELECT id, study_item_id, assigned_for_date, status, origin, created_at
              FROM daily_assignment
              WHERE id = ?
              `
            )
            .get(existingAssignment.id) as {
            id: number;
            study_item_id: number;
            assigned_for_date: string;
            status: AssignmentStatus;
            origin: AssignmentOrigin;
            created_at: string;
          };

          return {
            status: 200,
            body: intakeSuccessBody(studyItem, assignment, isNew)
          };
        }

        // Assignment in a non-archived state already exists, return 409 conflict
        return {
          status: 409,
          body: {
            error: 'Assignment already exists for this word and date',
            assignment: existingAssignment
          }
        };
      }

      const assignmentResult = sqlite
        .prepare(
          `
          INSERT INTO daily_assignment (
            study_item_id,
            assigned_for_date,
            status,
            origin,
            created_at,
            completed_at,
            time_spent_ms
          ) VALUES (?, ?, 'pending', ?, ?, NULL, NULL)
          `
        )
        .run(studyItem.id, assignedForDate, origin, now);

      const assignmentId = Number(assignmentResult.lastInsertRowid);

      // Write the estimate snapshot: compute the estimate with the existing
      // estimateAssignment against the freshly-inserted (pending) row and
      // persist it as integer ms. For a pending row this yields the Level-0
      // avg_completion_time_ms for previously-drilled items or the 4-level
      // fallback-chain value for never-drilled items. Done inside the same
      // transaction so the snapshot is atomic with assignment creation. The
      // snapshot is never recomputed by any later status transition.
      const estimatedMs = Math.round(estimateAssignment(sqlite, assignmentId));
      sqlite
        .prepare(`UPDATE daily_assignment SET estimated_ms = ? WHERE id = ?`)
        .run(estimatedMs, assignmentId);

      const assignment = sqlite
        .prepare(
          `
          SELECT id, study_item_id, assigned_for_date, status, origin, created_at
          FROM daily_assignment
          WHERE id = ?
          `
        )
        .get(assignmentId) as {
        id: number;
        study_item_id: number;
        assigned_for_date: string;
        status: AssignmentStatus;
        origin: AssignmentOrigin;
        created_at: string;
      };

      return {
        status: 201,
        body: intakeSuccessBody(studyItem, assignment, isNew)
      };
    });

    const result = transaction();
    return reply.status(result.status).send(result.body);
  });
}
