import { beforeEach, describe, expect, it } from 'vitest';

import { app } from './server.js';
import { sqlite } from './test-setup.js';
import {
  resetCounters,
  resetDb,
  seedAssignment,
  seedKanji,
  seedStudyItem,
  seedStudyItemKanji
} from './test-helpers.js';

type IntakeAssignment = {
  id: number;
  status: string;
  assigned_for_date: string;
};
type IntakeResponse = {
  study_item: { id: number; surface_form: string; selected_reading: string };
  assignment: IntakeAssignment;
};

async function intake(payload: {
  surface_form: string;
  selected_reading: string;
  dictionary_entry_id: number;
  assigned_for_date?: string;
}): Promise<{ status: number; body: IntakeResponse | { error: string } }> {
  const res = await app.inject({
    method: 'POST',
    url: '/study-items/intake',
    payload: JSON.stringify(payload),
    headers: { 'content-type': 'application/json' }
  });
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

function seedDictionaryEntry(id: number): void {
  const ts = '2024-01-01T00:00:00.000Z';
  sqlite
    .prepare(
      `INSERT INTO dictionary_entry (id, is_common, priority_rank, created_at, updated_at)
       VALUES (?, 1, NULL, ?, ?)
       ON CONFLICT(id) DO NOTHING`
    )
    .run(id, ts, ts);
}

function assignmentEstimatedMs(id: number): number | null {
  const row = sqlite
    .prepare(`SELECT estimated_ms FROM daily_assignment WHERE id = ?`)
    .get(id) as { estimated_ms: number | null } | undefined;
  return row?.estimated_ms ?? null;
}

function seedAttributionRow(
  assignmentId: number,
  kanjiLiteral: string,
  strokeCount: number,
  writesCount: number,
  attributedTimeMs: number
): void {
  sqlite
    .prepare(
      `INSERT INTO kanji_attribution (assignment_id, kanji_literal, stroke_count, writes_count, attributed_time_ms)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(assignmentId, kanjiLiteral, strokeCount, writesCount, attributedTimeMs);
}

describe('estimate snapshots at assignment creation', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('migration leaves existing rows NULL (no backfill)', () => {
    // seedAssignment without estimated_ms writes a legacy-style NULL row.
    const studyItemId = seedStudyItem();
    const assignment = seedAssignment({
      study_item_id: studyItemId,
      status: 'pending'
    });

    expect(assignmentEstimatedMs(assignment.id)).toBeNull();
  });

  it('intake of a previously-drilled word stores estimated_ms = avg_completion_time_ms (integer ms)', async () => {
    const studyItemId = seedStudyItem();
    // One prior completion → avg_completion_time_ms = 24500.5.
    seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 24500.5
    });

    const res = await intake({
      surface_form: `形${studyItemId}`,
      selected_reading: `よみ${studyItemId}`,
      dictionary_entry_id: 1,
      assigned_for_date: '2024-01-02'
    });

    expect(res.status).toBe(201);
    const body = res.body as IntakeResponse;
    // Math.round(24500.5) = 24501 (round-half-up).
    expect(assignmentEstimatedMs(body.assignment.id)).toBe(24501);
  });

  it('intake of a never-drilled word uses the Level-1 fallback chain value', async () => {
    seedDictionaryEntry(7);
    seedKanji('山', 3);

    // Drill a different word containing 山 so v_kanji_timing has it.
    const drilledItem = seedStudyItem(sqlite, 1, {
      surface_form: '山',
      selected_reading: 'やま'
    });
    seedStudyItemKanji(drilledItem, [{ position: 0, literal: '山' }]);
    const drilledAssignment = seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 12000
    });
    // 山 written 10 times with a kanji pool of 10000 ms -> 1000 ms per write.
    seedAttributionRow(drilledAssignment.id, '山', 3, 10, 10000);

    const res = await intake({
      surface_form: '山',
      selected_reading: 'やま',
      dictionary_entry_id: 7,
      assigned_for_date: '2024-01-02'
    });

    expect(res.status).toBe(201);
    const body = res.body as IntakeResponse;
    // 10 kanji writes @ 1000 ms + 2 reading-writing kana writes @ 1000 ms.
    expect(assignmentEstimatedMs(body.assignment.id)).toBe(12000);
  });

  it('intake of a never-drilled word with no attribution data uses the Level-4 floor + pad', async () => {
    seedDictionaryEntry(8);
    seedKanji('山', 3);

    const res = await intake({
      surface_form: '山',
      selected_reading: 'やま',
      dictionary_entry_id: 8,
      assigned_for_date: '2024-01-02'
    });

    expect(res.status).toBe(201);
    const body = res.body as IntakeResponse;
    // 10 * (600 * 3) + 2 * 1000 + 10000 pad = 30000.
    expect(assignmentEstimatedMs(body.assignment.id)).toBe(30000);
  });

  it('a pending assignment snapshot does not drift when other words are completed afterwards', async () => {
    seedDictionaryEntry(9);
    seedKanji('山', 3);

    // Intake a pending word; its snapshot is the Level-4 floor value (30000).
    const firstRes = await intake({
      surface_form: '山',
      selected_reading: 'やま',
      dictionary_entry_id: 9,
      assigned_for_date: '2024-01-02'
    });
    const firstAssignment = (firstRes.body as IntakeResponse).assignment;
    const snapshotBefore = assignmentEstimatedMs(firstAssignment.id);
    expect(snapshotBefore).toBe(30000);

    // Now drill a different study item that shares the kanji, populating
    // v_kanji_timing. If the snapshot drifted, it would change.
    const drilledItem = seedStudyItem(sqlite, 2, {
      surface_form: '山',
      selected_reading: 'やま'
    });
    seedStudyItemKanji(drilledItem, [{ position: 0, literal: '山' }]);
    const drilledAssignment = seedAssignment({
      study_item_id: drilledItem,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 12000
    });
    seedAttributionRow(drilledAssignment.id, '山', 3, 10, 10000);

    // The pending row's snapshot must remain the original 30000.
    expect(assignmentEstimatedMs(firstAssignment.id)).toBe(snapshotBefore);
    expect(assignmentEstimatedMs(firstAssignment.id)).toBe(30000);
  });

  it('reopen then recomplete leaves estimated_ms unchanged', async () => {
    const studyItemId = seedStudyItem();
    // Prior completion so intake writes a Level-0 snapshot of 20000.
    seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 20000
    });

    const intakeRes = await intake({
      surface_form: `形${studyItemId}`,
      selected_reading: `よみ${studyItemId}`,
      dictionary_entry_id: 1,
      assigned_for_date: '2024-01-02'
    });
    const assignment = (intakeRes.body as IntakeResponse).assignment;
    const snapshot = assignmentEstimatedMs(assignment.id);
    expect(snapshot).toBe(20000);

    // Complete the assignment (time_spent very different from snapshot).
    await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/complete`,
      payload: JSON.stringify({ time_spent_ms: 45000 }),
      headers: { 'content-type': 'application/json' }
    });
    expect(assignmentEstimatedMs(assignment.id)).toBe(snapshot);

    // Reopen (deletes attribution, resets time_spent_ms to NULL).
    await app.inject({ method: 'POST', url: `/assignments/${assignment.id}/reopen` });
    expect(assignmentEstimatedMs(assignment.id)).toBe(snapshot);

    // Recomplete with a different time — snapshot stays the original.
    await app.inject({
      method: 'POST',
      url: `/assignments/${assignment.id}/complete`,
      payload: JSON.stringify({ time_spent_ms: 9000 }),
      headers: { 'content-type': 'application/json' }
    });
    expect(assignmentEstimatedMs(assignment.id)).toBe(snapshot);
  });

  it('unarchive-reactivate via intake preserves whatever snapshot exists', async () => {
    const studyItemId = seedStudyItem();
    // Prior completion → intake snapshot of 20000.
    seedAssignment({
      study_item_id: studyItemId,
      assigned_for_date: '2024-01-01',
      status: 'completed',
      time_spent_ms: 20000
    });

    // Intake creates the pending assignment with a snapshot.
    const firstRes = await intake({
      surface_form: `形${studyItemId}`,
      selected_reading: `よみ${studyItemId}`,
      dictionary_entry_id: 1,
      assigned_for_date: '2024-01-02'
    });
    const assignment = (firstRes.body as IntakeResponse).assignment;
    expect(assignmentEstimatedMs(assignment.id)).toBe(20000);

    // Archive it (Removal).
    await app.inject({ method: 'POST', url: `/assignments/${assignment.id}/archive` });
    expect(assignmentEstimatedMs(assignment.id)).toBe(20000);

    // Re-add via intake — the unarchive-reactivate path must NOT rewrite the
    // snapshot.
    const secondRes = await intake({
      surface_form: `形${studyItemId}`,
      selected_reading: `よみ${studyItemId}`,
      dictionary_entry_id: 1,
      assigned_for_date: '2024-01-02'
    });
    expect(secondRes.status).toBe(200);
    expect((secondRes.body as IntakeResponse).assignment.id).toBe(assignment.id);
    expect(assignmentEstimatedMs(assignment.id)).toBe(20000);
  });

  it('unarchive-reactivate preserves a NULL snapshot for a legacy (pre-feature) archived row', async () => {
    const studyItemId = seedStudyItem();
    // Legacy archived row: no snapshot.
    const assignment = seedAssignment({
      study_item_id: studyItemId,
      status: 'archived',
      assigned_for_date: '2024-01-02'
    });
    expect(assignmentEstimatedMs(assignment.id)).toBeNull();

    const res = await intake({
      surface_form: `形${studyItemId}`,
      selected_reading: `よみ${studyItemId}`,
      dictionary_entry_id: 1,
      assigned_for_date: '2024-01-02'
    });

    expect(res.status).toBe(200);
    // The row keeps NULL — no snapshot is written on the reactivate path.
    expect(assignmentEstimatedMs(assignment.id)).toBeNull();
  });
});

describe('GET /assignments exposes estimated_ms', () => {
  beforeEach(() => {
    resetDb();
    resetCounters();
  });

  it('returns estimated_ms: null for legacy rows and the stored value for new rows', async () => {
    const legacyItemId = seedStudyItem();
    // Legacy row: no snapshot.
    seedAssignment({
      study_item_id: legacyItemId,
      status: 'pending',
      assigned_for_date: '2024-01-01'
    });

    // New row via intake, with prior completion so snapshot = 20000.
    const newItemId = seedStudyItem(sqlite, 2);
    seedAssignment({
      study_item_id: newItemId,
      assigned_for_date: '2023-12-31',
      status: 'completed',
      time_spent_ms: 20000
    });
    const intakeRes = await intake({
      surface_form: `形${newItemId}`,
      selected_reading: `よみ${newItemId}`,
      dictionary_entry_id: 2,
      assigned_for_date: '2024-01-01'
    });
    const newAssignmentId = (intakeRes.body as IntakeResponse).assignment.id;

    const res = await app.inject({
      method: 'GET',
      url: '/assignments?date=2024-01-01'
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as {
      assignments: Array<{ id: number; estimated_ms: number | null }>;
    };
    const byId = new Map(body.assignments.map((a) => [a.id, a.estimated_ms]));
    expect(byId.size).toBe(2);
    // Legacy row present with null.
    expect(byId.get(legacyItemId)).toBeNull();
    // New row present with the integer snapshot.
    expect(byId.get(newAssignmentId)).toBe(20000);
  });
});