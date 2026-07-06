import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import {
  assignmentsQuerySchema,
  dictionarySearchQuerySchema,
  intakeRequestSchema,
  queueSourceSchema,
  updateAssignmentTimeSchema
} from '@kanjiscribe/shared';
import Fastify from 'fastify';

import { appConfig, nowIso, todayIsoDate } from './config.js';
import { sqlite } from './db/client.js';

type MatchType = 'exact_spelling' | 'exact_reading' | 'prefix_spelling' | 'prefix_reading';

const MATCH_PRIORITY: Record<MatchType, number> = {
  exact_spelling: 0,
  exact_reading: 1,
  prefix_spelling: 2,
  prefix_reading: 3
};

function safeJsonParse<T>(value: string | null): T {
  if (!value) {
    return [] as T;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return [] as T;
  }
}

function isKanjiChar(char: string): boolean {
  const codePoint = char.codePointAt(0);
  if (!codePoint) {
    return false;
  }
  return (codePoint >= 0x4e00 && codePoint <= 0x9fff) || (codePoint >= 0x3400 && codePoint <= 0x4dbf);
}

function kanjiSvgFilename(char: string): string {
  const codePoint = char.codePointAt(0) ?? 0;
  return codePoint.toString(16).padStart(5, '0').toLowerCase();
}

function runMigrationsOnBoot(): void {
  const sqlDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'db/sql');
  if (!fs.existsSync(sqlDir)) {
    return;
  }
  const files = fs
    .readdirSync(sqlDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(sqlDir, file), 'utf-8');
    sqlite.exec(sql);
  }
}

function getEntryDetails(entryId: number) {
  const entry = sqlite
    .prepare(
      `
      SELECT id, is_common, priority_rank
      FROM dictionary_entry
      WHERE id = ?
      `
    )
    .get(entryId) as { id: number; is_common: number; priority_rank: number | null } | undefined;

  if (!entry) {
    return null;
  }

  const spellings = sqlite
    .prepare(
      `
      SELECT text, is_primary, priority_rank
      FROM entry_spelling
      WHERE entry_id = ?
      ORDER BY is_primary DESC, text ASC
      `
    )
    .all(entryId) as Array<{ text: string; is_primary: number; priority_rank: number | null }>;

  const readings = sqlite
    .prepare(
      `
      SELECT text, is_primary, no_kanji
      FROM entry_reading
      WHERE entry_id = ?
      ORDER BY is_primary DESC, text ASC
      `
    )
    .all(entryId) as Array<{ text: string; is_primary: number; no_kanji: number }>;

  const senses = sqlite
    .prepare(
      `
      SELECT
        sense_index,
        glosses_json,
        parts_of_speech_json,
        misc_tags_json,
        field_tags_json,
        dialect_tags_json,
        info_json
      FROM entry_sense
      WHERE entry_id = ?
      ORDER BY sense_index ASC
      `
    )
    .all(entryId) as Array<{
    sense_index: number;
    glosses_json: string;
    parts_of_speech_json: string;
    misc_tags_json: string;
    field_tags_json: string;
    dialect_tags_json: string;
    info_json: string;
  }>;

  const readingRestrictions = sqlite
    .prepare(
      `
      SELECT reading_text, spelling_text
      FROM entry_reading_spelling
      WHERE entry_id = ?
      ORDER BY reading_text ASC, spelling_text ASC
      `
    )
    .all(entryId) as Array<{ reading_text: string; spelling_text: string }>;

  return {
    id: entry.id,
    is_common: Boolean(entry.is_common),
    priority_rank: entry.priority_rank,
    spellings: spellings.map((item) => ({
      text: item.text,
      is_primary: Boolean(item.is_primary),
      priority_rank: item.priority_rank
    })),
    readings: readings.map((item) => ({
      text: item.text,
      is_primary: Boolean(item.is_primary),
      no_kanji: Boolean(item.no_kanji)
    })),
    senses: senses.map((sense) => ({
      sense_index: sense.sense_index,
      glosses: safeJsonParse<string[]>(sense.glosses_json),
      parts_of_speech: safeJsonParse<string[]>(sense.parts_of_speech_json),
      misc_tags: safeJsonParse<string[]>(sense.misc_tags_json),
      field_tags: safeJsonParse<string[]>(sense.field_tags_json),
      dialect_tags: safeJsonParse<string[]>(sense.dialect_tags_json),
      info: safeJsonParse<string[]>(sense.info_json)
    })),
    reading_restrictions: readingRestrictions
  };
}

function searchDictionary(query: string) {
  const today = todayIsoDate();
  const matches = new Map<number, MatchType>();

  const strategies: Array<{ type: MatchType; sql: string; value: string }> = [
    {
      type: 'exact_spelling',
      sql: `SELECT DISTINCT entry_id FROM entry_spelling WHERE text = ? LIMIT 50`,
      value: query
    },
    {
      type: 'exact_reading',
      sql: `SELECT DISTINCT entry_id FROM entry_reading WHERE text = ? LIMIT 50`,
      value: query
    },
    {
      type: 'prefix_spelling',
      sql: `SELECT DISTINCT entry_id FROM entry_spelling WHERE text LIKE ? LIMIT 50`,
      value: `${query}%`
    },
    {
      type: 'prefix_reading',
      sql: `SELECT DISTINCT entry_id FROM entry_reading WHERE text LIKE ? LIMIT 50`,
      value: `${query}%`
    }
  ];

  for (const strategy of strategies) {
    const rows = sqlite.prepare(strategy.sql).all(strategy.value) as Array<{ entry_id: number }>;
    for (const row of rows) {
      const existing = matches.get(row.entry_id);
      if (!existing || MATCH_PRIORITY[strategy.type] < MATCH_PRIORITY[existing]) {
        matches.set(row.entry_id, strategy.type);
      }
    }
  }

  const ids = Array.from(matches.keys());
  if (ids.length === 0) {
    return [];
  }

  const placeholders = ids.map(() => '?').join(', ');
  const baseRows = sqlite
    .prepare(
      `
      SELECT
        de.id,
        de.is_common,
        de.priority_rank,
        (
          SELECT text
          FROM entry_spelling es
          WHERE es.entry_id = de.id
          ORDER BY is_primary DESC, text ASC
          LIMIT 1
        ) AS primary_spelling,
        (
          SELECT text
          FROM entry_reading er
          WHERE er.entry_id = de.id
          ORDER BY is_primary DESC, text ASC
          LIMIT 1
        ) AS primary_reading,
        (
          SELECT glosses_json
          FROM entry_sense se
          WHERE se.entry_id = de.id
          ORDER BY sense_index ASC
          LIMIT 1
        ) AS first_glosses_json,
        (
          SELECT COUNT(*)
          FROM daily_assignment da
          JOIN study_item si ON si.id = da.study_item_id
          WHERE
            si.dictionary_entry_id = de.id
            AND da.assigned_for_date = ?
            AND da.status != 'archived'
        ) AS today_assigned_count
      FROM dictionary_entry de
      WHERE de.id IN (${placeholders})
      `
    )
    .all(today, ...ids) as Array<{
    id: number;
    is_common: number;
    priority_rank: number | null;
    primary_spelling: string | null;
    primary_reading: string | null;
    first_glosses_json: string | null;
    today_assigned_count: number;
  }>;

  const spellings = sqlite
    .prepare(
      `
      SELECT entry_id, text, is_primary
      FROM entry_spelling
      WHERE entry_id IN (${placeholders})
      ORDER BY is_primary DESC, text ASC
      `
    )
    .all(...ids) as Array<{ entry_id: number; text: string; is_primary: number }>;

  const readings = sqlite
    .prepare(
      `
      SELECT entry_id, text, no_kanji
      FROM entry_reading
      WHERE entry_id IN (${placeholders})
      ORDER BY is_primary DESC, text ASC
      `
    )
    .all(...ids) as Array<{ entry_id: number; text: string; no_kanji: number }>;

  const spellingsByEntry = new Map<number, Array<{ text: string; is_primary: boolean }>>();
  const readingsByEntry = new Map<number, Array<{ text: string; no_kanji: boolean }>>();

  for (const row of spellings) {
    const current = spellingsByEntry.get(row.entry_id) ?? [];
    current.push({ text: row.text, is_primary: Boolean(row.is_primary) });
    spellingsByEntry.set(row.entry_id, current);
  }

  for (const row of readings) {
    const current = readingsByEntry.get(row.entry_id) ?? [];
    current.push({ text: row.text, no_kanji: Boolean(row.no_kanji) });
    readingsByEntry.set(row.entry_id, current);
  }

  return baseRows
    .map((row) => {
      const glosses = safeJsonParse<string[]>(row.first_glosses_json).slice(0, 5);
      return {
        entry_id: row.id,
        primary_spelling: row.primary_spelling,
        primary_reading: row.primary_reading,
        glosses,
        is_common: Boolean(row.is_common),
        readings: readingsByEntry.get(row.id) ?? [],
        spellings: spellingsByEntry.get(row.id) ?? [],
        priority_rank: row.priority_rank,
        today_assigned: row.today_assigned_count > 0,
        match_type: matches.get(row.id) ?? 'prefix_reading'
      };
    })
    .sort((a, b) => {
      const matchDiff = MATCH_PRIORITY[a.match_type] - MATCH_PRIORITY[b.match_type];
      if (matchDiff !== 0) {
        return matchDiff;
      }
      if (a.is_common !== b.is_common) {
        return a.is_common ? -1 : 1;
      }
      const aRank = a.priority_rank ?? Number.MAX_SAFE_INTEGER;
      const bRank = b.priority_rank ?? Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    })
    .slice(0, 50)
    .map(({ priority_rank: _priorityRank, ...result }) => result);
}

function listAssignments(params: { status?: string; date?: string; backlogOnly?: boolean }) {
  const where: string[] = [];
  const values: unknown[] = [];

  if (params.backlogOnly) {
    where.push(`da.status IN ('pending', 'skipped')`);
  }

  if (params.status) {
    where.push(`da.status = ?`);
    values.push(params.status);
  }

  if (params.date) {
    where.push(`da.assigned_for_date = ?`);
    values.push(params.date);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = 'ORDER BY da.assigned_for_date ASC, da.created_at ASC';

  const rows = sqlite
    .prepare(
      `
      SELECT
        da.id,
        da.study_item_id,
        da.assigned_for_date,
        da.status,
        da.origin,
        da.time_spent_ms,
        da.created_at,
        da.completed_at,
        si.surface_form,
        si.selected_reading,
        (
          SELECT json_extract(es.glosses_json, '$[0]')
          FROM entry_sense es
          WHERE es.entry_id = si.dictionary_entry_id
          ORDER BY es.sense_index ASC
          LIMIT 1
        ) AS first_gloss
      FROM daily_assignment da
      JOIN study_item si ON si.id = da.study_item_id
      ${whereSql}
      ${orderSql}
      `
    )
    .all(...values) as Array<{
    id: number;
    study_item_id: number;
    assigned_for_date: string;
    status: string;
    origin: string;
    time_spent_ms: number | null;
    created_at: string;
    completed_at: string | null;
    surface_form: string;
    selected_reading: string;
    first_gloss: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    study_item_id: row.study_item_id,
    assigned_for_date: row.assigned_for_date,
    status: row.status,
    origin: row.origin,
    time_spent_ms: row.time_spent_ms,
    created_at: row.created_at,
    completed_at: row.completed_at,
    study_item: {
      surface_form: row.surface_form,
      selected_reading: row.selected_reading,
      first_gloss: row.first_gloss
    }
  }));
}

function computeQueue(assignmentId: number, queueSource?: 'today' | 'backlog') {
  const assignmentMeta = sqlite
    .prepare(`SELECT assigned_for_date FROM daily_assignment WHERE id = ?`)
    .get(assignmentId) as { assigned_for_date: string } | undefined;

  let queue: Array<{ id: number }> = [];

  if (queueSource === 'today') {
    if (assignmentMeta) {
      queue = sqlite
        .prepare(
          `
          SELECT id
          FROM daily_assignment
          WHERE status != 'archived' AND assigned_for_date = ?
          ORDER BY created_at ASC
          `
        )
        .all(assignmentMeta.assigned_for_date) as Array<{ id: number }>;
    }
  } else if (queueSource === 'backlog') {
    queue = sqlite
      .prepare(
        `
        SELECT id
        FROM daily_assignment
        WHERE status IN ('pending', 'skipped', 'completed')
        ORDER BY assigned_for_date ASC, created_at ASC
        `
      )
      .all() as Array<{ id: number }>;
  } else {
    queue = [{ id: assignmentId }];
  }

  if (!queue.some((item) => item.id === assignmentId)) {
    queue.unshift({ id: assignmentId });
  }

  const currentIndex = Math.max(
    0,
    queue.findIndex((item) => item.id === assignmentId)
  );
  const prev = currentIndex > 0 ? queue[currentIndex - 1] : null;
  const next = currentIndex < queue.length - 1 ? queue[currentIndex + 1] : null;

  const dayProgress = assignmentMeta
    ? (sqlite
        .prepare(
          `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
          FROM daily_assignment
          WHERE assigned_for_date = ? AND status != 'archived'
          `
        )
        .get(assignmentMeta.assigned_for_date) as { total: number; completed: number | null })
    : { total: 0, completed: 0 };

  return {
    current_index: currentIndex,
    total: queue.length,
    next_assignment_id: next?.id ?? null,
    prev_assignment_id: prev?.id ?? null,
    day_completed_count: dayProgress.completed ?? 0,
    day_total_count: dayProgress.total
  };
}

runMigrationsOnBoot();

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true
});

if (fs.existsSync(appConfig.kanjiSvgDir)) {
  await app.register(fastifyStatic, {
    root: appConfig.kanjiSvgDir,
    prefix: '/static/kanji-svg/',
    decorateReply: false
  });
}

if (fs.existsSync(appConfig.webDistDir)) {
  await app.register(fastifyStatic, {
    root: appConfig.webDistDir,
    prefix: '/',
    wildcard: false
  });
}

app.setErrorHandler((error, _request, reply) => {
  requestLogSafe(error);
  reply.status(500).send({ error: 'Internal server error' });
});

app.get('/health', async () => ({ ok: true }));

app.get('/dictionary/search', async (request, reply) => {
  const parsed = dictionarySearchQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid query' });
  }

  const results = searchDictionary(parsed.data.q);
  return { results };
});

app.get('/dictionary/entries/:id', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    return reply.status(400).send({ error: 'Invalid entry id' });
  }

  const entry = getEntryDetails(id);
  if (!entry) {
    return reply.status(404).send({ error: 'Dictionary entry not found' });
  }

  return { entry };
});

app.post('/study-items/intake', async (request, reply) => {
  const parsed = intakeRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
  }

  const payload = parsed.data;
  const now = nowIso();
  const assignedForDate = payload.assigned_for_date ?? todayIsoDate();
  const origin = payload.source_type === 'anki' ? 'anki_rule' : 'manual';

  const dictionaryExists = sqlite
    .prepare('SELECT id FROM dictionary_entry WHERE id = ?')
    .get(payload.dictionary_entry_id) as { id: number } | undefined;

  if (!dictionaryExists) {
    return reply.status(404).send({ error: 'Dictionary entry not found' });
  }

  const transaction = sqlite.transaction(() => {
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
          source_type: string;
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
      // Assignment already exists, return 409 conflict
      return reply.status(409).send({ 
        error: 'Assignment already exists for this word and date',
        assignment: existingAssignment
      });
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
      status: string;
      origin: string;
      created_at: string;
    };

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
  });

  const result = transaction();
  return reply.status(201).send(result);
});

app.get('/assignments', async (request, reply) => {
  const parsed = assignmentsQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid query' });
  }

  const assignments = listAssignments({
    status: parsed.data.status,
    date: parsed.data.date
  });

  return { assignments };
});

app.get('/assignments/backlog', async () => {
  const assignments = listAssignments({ backlogOnly: true });

  const dates = [...new Set(assignments.map((a) => a.assigned_for_date))];
  const placeholders = dates.map(() => '?').join(',');
  const dayStats = sqlite
    .prepare(
      `
      SELECT
        assigned_for_date AS date,
        total_assignments,
        completed_count,
        pending_count
      FROM v_day_summary
      WHERE assigned_for_date IN (${placeholders})
      `
    )
    .all(...dates) as Array<{
      date: string;
      total_assignments: number;
      completed_count: number;
      pending_count: number;
    }>;

  const dayStatsMap = new Map(dayStats.map((d) => [d.date, d]));

  return { assignments, dayStats: dayStatsMap };
});

app.get('/assignments/:id/drill', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    return reply.status(400).send({ error: 'Invalid assignment id' });
  }

  const sourceParsed = queueSourceSchema.safeParse((request.query as { queue_source?: unknown }).queue_source);
  if (!sourceParsed.success) {
    return reply.status(400).send({ error: 'Invalid queue source' });
  }

  const row = sqlite
    .prepare(
      `
      SELECT
        da.id,
        da.assigned_for_date,
        da.status,
        da.origin,
        da.study_item_id,
        si.surface_form,
        si.selected_reading,
        si.dictionary_entry_id
      FROM daily_assignment da
      JOIN study_item si ON si.id = da.study_item_id
      WHERE da.id = ?
      `
    )
    .get(id) as
    | {
        id: number;
        assigned_for_date: string;
        status: string;
        origin: string;
        study_item_id: number;
        surface_form: string;
        selected_reading: string;
        dictionary_entry_id: number;
      }
    | undefined;

  if (!row) {
    return reply.status(404).send({ error: 'Assignment not found' });
  }

  const entry = getEntryDetails(row.dictionary_entry_id);
  if (!entry) {
    return reply.status(404).send({ error: 'Dictionary entry not found' });
  }

  const kanjiRows = sqlite
    .prepare(
      `
      SELECT
        sik.position,
        k.literal,
        k.meanings_json,
        k.onyomi_json,
        k.kunyomi_json,
        k.stroke_count,
        k.grade,
        k.jlpt_level,
        k.frequency_rank,
        ksa.asset_path
      FROM study_item_kanji sik
      JOIN kanji k ON k.literal = sik.kanji_literal
      LEFT JOIN kanji_stroke_asset ksa ON ksa.kanji_literal = k.literal
      WHERE sik.study_item_id = ?
      ORDER BY sik.position ASC
      `
    )
    .all(row.study_item_id) as Array<{
    position: number;
    literal: string;
    meanings_json: string;
    onyomi_json: string;
    kunyomi_json: string;
    stroke_count: number;
    grade: number | null;
    jlpt_level: number | null;
    frequency_rank: number | null;
    asset_path: string | null;
  }>;

  const queue = computeQueue(id, sourceParsed.data);

  const dayTotalRow = sqlite
    .prepare(
      `
      SELECT SUM(COALESCE(time_spent_ms, 0)) AS total_time_ms
      FROM daily_assignment
      WHERE assigned_for_date = ?
      `
    )
    .get(row.assigned_for_date) as { total_time_ms: number | null };

  return {
    assignment: {
      id: row.id,
      assigned_for_date: row.assigned_for_date,
      status: row.status,
      origin: row.origin
    },
    study_item: {
      id: row.study_item_id,
      surface_form: row.surface_form,
      selected_reading: row.selected_reading
    },
    dictionary_entry: {
      id: entry.id,
      is_common: entry.is_common,
      primary_spelling: entry.spellings[0]?.text ?? row.surface_form,
      primary_reading: entry.readings[0]?.text ?? row.selected_reading,
      senses: entry.senses.map((sense) => ({
        sense_index: sense.sense_index,
        glosses: sense.glosses,
        parts_of_speech: sense.parts_of_speech
      }))
    },
    kanji: kanjiRows.map((item) => ({
      literal: item.literal,
      position: item.position,
      meanings: safeJsonParse<string[]>(item.meanings_json),
      onyomi: safeJsonParse<string[]>(item.onyomi_json),
      kunyomi: safeJsonParse<string[]>(item.kunyomi_json),
      stroke_count: item.stroke_count,
      grade: item.grade,
      jlpt_level: item.jlpt_level,
      frequency_rank: item.frequency_rank,
      stroke_asset_url: item.asset_path ? `/static/${item.asset_path}` : null
    })),
    queue,
    day_total_time_ms: dayTotalRow.total_time_ms ?? 0
  };
});

app.get('/assignments/:id/view', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    return reply.status(400).send({ error: 'Invalid assignment id' });
  }

  const row = sqlite
    .prepare(
      `
      SELECT
        da.id,
        da.assigned_for_date,
        da.status,
        da.origin,
        da.time_spent_ms,
        da.study_item_id,
        si.surface_form,
        si.selected_reading,
        si.dictionary_entry_id
      FROM daily_assignment da
      JOIN study_item si ON si.id = da.study_item_id
      WHERE da.id = ?
      `
    )
    .get(id) as
    | {
        id: number;
        assigned_for_date: string;
        status: string;
        origin: string;
        time_spent_ms: number | null;
        study_item_id: number;
        surface_form: string;
        selected_reading: string;
        dictionary_entry_id: number;
      }
    | undefined;

  if (!row) {
    return reply.status(404).send({ error: 'Assignment not found' });
  }

  const entry = getEntryDetails(row.dictionary_entry_id);
  if (!entry) {
    return reply.status(404).send({ error: 'Dictionary entry not found' });
  }

  const kanjiRows = sqlite
    .prepare(
      `
      SELECT
        sik.position,
        k.literal,
        k.meanings_json,
        k.onyomi_json,
        k.kunyomi_json,
        k.stroke_count,
        k.grade,
        k.jlpt_level,
        k.frequency_rank,
        ksa.asset_path
      FROM study_item_kanji sik
      JOIN kanji k ON k.literal = sik.kanji_literal
      LEFT JOIN kanji_stroke_asset ksa ON ksa.kanji_literal = k.literal
      WHERE sik.study_item_id = ?
      ORDER BY sik.position ASC
      `
    )
    .all(row.study_item_id) as Array<{
    position: number;
    literal: string;
    meanings_json: string;
    onyomi_json: string;
    kunyomi_json: string;
    stroke_count: number;
    grade: number | null;
    jlpt_level: number | null;
    frequency_rank: number | null;
    asset_path: string | null;
  }>;

  return {
    assignment: {
      id: row.id,
      assigned_for_date: row.assigned_for_date,
      status: row.status,
      origin: row.origin,
      time_spent_ms: row.time_spent_ms
    },
    study_item: {
      id: row.study_item_id,
      surface_form: row.surface_form,
      selected_reading: row.selected_reading
    },
    dictionary_entry: {
      id: entry.id,
      is_common: entry.is_common,
      primary_spelling: entry.spellings[0]?.text ?? row.surface_form,
      primary_reading: entry.readings[0]?.text ?? row.selected_reading,
      senses: entry.senses.map((sense) => ({
        sense_index: sense.sense_index,
        glosses: sense.glosses,
        parts_of_speech: sense.parts_of_speech
      }))
    },
    kanji: kanjiRows.map((item) => ({
      literal: item.literal,
      position: item.position,
      meanings: safeJsonParse<string[]>(item.meanings_json),
      onyomi: safeJsonParse<string[]>(item.onyomi_json),
      kunyomi: safeJsonParse<string[]>(item.kunyomi_json),
      stroke_count: item.stroke_count,
      grade: item.grade,
      jlpt_level: item.jlpt_level,
      frequency_rank: item.frequency_rank,
      stroke_asset_url: item.asset_path ? `/static/${item.asset_path}` : null
    }))
  };
});

app.post('/assignments/:id/complete', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    return reply.status(400).send({ error: 'Invalid assignment id' });
  }

  const parsed = updateAssignmentTimeSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
  }

  const now = nowIso();
  const result = sqlite
    .prepare(
      `
      UPDATE daily_assignment
      SET
        status = 'completed',
        completed_at = ?,
        time_spent_ms = COALESCE(?, time_spent_ms)
      WHERE id = ?
      `
    )
    .run(now, parsed.data.time_spent_ms ?? null, id);

  if (result.changes === 0) {
    return reply.status(404).send({ error: 'Assignment not found' });
  }

  const assignment = sqlite
    .prepare(`SELECT id, status, time_spent_ms, completed_at FROM daily_assignment WHERE id = ?`)
    .get(id) as { id: number; status: string; time_spent_ms: number | null; completed_at: string | null };

  return { assignment };
});

app.post('/assignments/:id/skip', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    return reply.status(400).send({ error: 'Invalid assignment id' });
  }

  const parsed = updateAssignmentTimeSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'Invalid request body' });
  }

  const result = sqlite
    .prepare(
      `
      UPDATE daily_assignment
      SET
        status = 'skipped',
        completed_at = NULL,
        time_spent_ms = COALESCE(?, time_spent_ms)
      WHERE id = ?
      `
    )
    .run(parsed.data.time_spent_ms ?? null, id);

  if (result.changes === 0) {
    return reply.status(404).send({ error: 'Assignment not found' });
  }

  const assignment = sqlite
    .prepare(`SELECT id, status, time_spent_ms, completed_at FROM daily_assignment WHERE id = ?`)
    .get(id) as { id: number; status: string; time_spent_ms: number | null; completed_at: string | null };

  return { assignment };
});

app.post('/assignments/:id/reopen', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    return reply.status(400).send({ error: 'Invalid assignment id' });
  }

  const result = sqlite
    .prepare(
      `
      UPDATE daily_assignment
      SET status = 'pending', completed_at = NULL, time_spent_ms = NULL
      WHERE id = ?
      `
    )
    .run(id);

  if (result.changes === 0) {
    return reply.status(404).send({ error: 'Assignment not found' });
  }

  const assignment = sqlite
    .prepare(`SELECT id, status, time_spent_ms, completed_at FROM daily_assignment WHERE id = ?`)
    .get(id) as { id: number; status: string; time_spent_ms: number | null; completed_at: string | null };

  return { assignment };
});

app.get('/stats/dashboard', async (request) => {
  const query = request.query as { from?: string; to?: string };
  const to = query.to ?? todayIsoDate();
  const fromDate = query.from ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const today = todayIsoDate();
  const todayRow = sqlite
    .prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(COALESCE(time_spent_ms, 0)) AS total_time_ms,
        AVG(CASE WHEN status = 'completed' THEN time_spent_ms END) AS avg_time_per_assignment_ms
      FROM daily_assignment
      WHERE assigned_for_date = ?
      `
    )
    .get(today) as {
    total: number;
    pending: number | null;
    completed: number | null;
    total_time_ms: number | null;
    avg_time_per_assignment_ms: number | null;
  };

  const overdueRow = sqlite
    .prepare(
      `
      SELECT
        COUNT(*) AS total_pending,
        MIN(assigned_for_date) AS oldest_date,
        COUNT(DISTINCT assigned_for_date) AS incomplete_days
      FROM daily_assignment
      WHERE status IN ('pending', 'skipped') AND assigned_for_date < ?
      `
    )
    .get(today) as { total_pending: number; oldest_date: string | null; incomplete_days: number };

  const totalRow = sqlite
    .prepare(
      `
      SELECT
        SUM(COALESCE(time_spent_ms, 0)) AS total_time_ms,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS total_completed,
        AVG(CASE WHEN status = 'completed' THEN time_spent_ms END) AS avg_time_per_assignment_ms
      FROM daily_assignment
      `
    )
    .get() as {
    total_time_ms: number | null;
    total_completed: number | null;
    avg_time_per_assignment_ms: number | null;
  };

  const heatmap = sqlite
    .prepare(
      `
      SELECT
        assigned_for_date AS date,
        total_assignments,
        completed_count,
        pending_count,
        skipped_count,
        total_time_ms,
        is_fully_completed
      FROM v_day_summary
      WHERE assigned_for_date BETWEEN ? AND ?
      ORDER BY assigned_for_date ASC
      `
    )
    .all(fromDate, to) as Array<{
    date: string;
    total_assignments: number;
    completed_count: number;
    pending_count: number;
    skipped_count: number;
    total_time_ms: number;
    is_fully_completed: number;
  }>;

  return {
    today: {
      total: todayRow.total,
      pending: todayRow.pending ?? 0,
      completed: todayRow.completed ?? 0,
      total_time_ms: todayRow.total_time_ms ?? 0,
      avg_time_per_assignment_ms: Math.round(todayRow.avg_time_per_assignment_ms ?? 0)
    },
    overdue: {
      total_pending: overdueRow.total_pending,
      oldest_date: overdueRow.oldest_date,
      incomplete_days: overdueRow.incomplete_days
    },
    totals: {
      total_time_ms: totalRow.total_time_ms ?? 0,
      total_completed: totalRow.total_completed ?? 0,
      avg_time_per_assignment_ms: Math.round(totalRow.avg_time_per_assignment_ms ?? 0)
    },
    heatmap: heatmap.map((day) => ({ ...day, is_fully_completed: Boolean(day.is_fully_completed) }))
  };
});

app.get('/stats/study-items/:id', async (request, reply) => {
  const id = Number((request.params as { id: string }).id);
  if (!Number.isInteger(id) || id <= 0) {
    return reply.status(400).send({ error: 'Invalid study item id' });
  }

  const studyItem = sqlite
    .prepare(`SELECT id, surface_form, selected_reading FROM study_item WHERE id = ?`)
    .get(id) as { id: number; surface_form: string; selected_reading: string } | undefined;

  if (!studyItem) {
    return reply.status(404).send({ error: 'Study item not found' });
  }

  const stats = sqlite
    .prepare(
      `
      SELECT
        total_assignments,
        times_completed,
        total_time_ms,
        avg_completion_time_ms,
        first_assigned,
        last_assigned
      FROM v_study_item_stats
      WHERE study_item_id = ?
      `
    )
    .get(id) as
    | {
        total_assignments: number;
        times_completed: number;
        total_time_ms: number;
        avg_completion_time_ms: number | null;
        first_assigned: string | null;
        last_assigned: string | null;
      }
    | undefined;

  const recentAssignments = sqlite
    .prepare(
      `
      SELECT id, assigned_for_date, status, time_spent_ms, completed_at
      FROM daily_assignment
      WHERE study_item_id = ?
      ORDER BY assigned_for_date DESC, created_at DESC
      LIMIT 10
      `
    )
    .all(id);

  return {
    study_item: studyItem,
    stats: {
      total_assignments: stats?.total_assignments ?? 0,
      times_completed: stats?.times_completed ?? 0,
      total_time_ms: stats?.total_time_ms ?? 0,
      avg_completion_time_ms: Math.round(stats?.avg_completion_time_ms ?? 0),
      first_assigned: stats?.first_assigned,
      last_assigned: stats?.last_assigned
    },
    recent_assignments: recentAssignments
  };
});

app.get('/stats/kanji/:literal', async (request, reply) => {
  const literal = decodeURIComponent((request.params as { literal: string }).literal);
  if (!literal) {
    return reply.status(400).send({ error: 'Invalid kanji literal' });
  }

  const row = sqlite
    .prepare(
      `
      SELECT
        k.literal,
        k.meanings_json,
        k.onyomi_json,
        k.kunyomi_json,
        k.stroke_count,
        k.grade,
        k.jlpt_level,
        k.frequency_rank,
        ksa.asset_path
      FROM kanji k
      LEFT JOIN kanji_stroke_asset ksa ON ksa.kanji_literal = k.literal
      WHERE k.literal = ?
      `
    )
    .get(literal) as
    | {
        literal: string;
        meanings_json: string;
        onyomi_json: string;
        kunyomi_json: string;
        stroke_count: number;
        grade: number | null;
        jlpt_level: number | null;
        frequency_rank: number | null;
        asset_path: string | null;
      }
    | undefined;

  if (!row) {
    return reply.status(404).send({ error: 'Kanji not found' });
  }

  const stats = sqlite
    .prepare(
      `
      SELECT word_count, total_assignments, times_drilled
      FROM v_kanji_stats
      WHERE kanji_literal = ?
      `
    )
    .get(literal) as { word_count: number; total_assignments: number; times_drilled: number } | undefined;

  const studyItems = sqlite
    .prepare(
      `
      SELECT DISTINCT si.id, si.surface_form, si.selected_reading
      FROM study_item_kanji sik
      JOIN study_item si ON si.id = sik.study_item_id
      WHERE sik.kanji_literal = ?
      ORDER BY si.created_at DESC
      LIMIT 50
      `
    )
    .all(literal);

  return {
    kanji: {
      literal: row.literal,
      meanings: safeJsonParse<string[]>(row.meanings_json),
      onyomi: safeJsonParse<string[]>(row.onyomi_json),
      kunyomi: safeJsonParse<string[]>(row.kunyomi_json),
      stroke_count: row.stroke_count,
      grade: row.grade,
      jlpt_level: row.jlpt_level,
      frequency_rank: row.frequency_rank,
      stroke_asset_url: row.asset_path ? `/static/${row.asset_path}` : null
    },
    stats: {
      word_count: stats?.word_count ?? 0,
      total_assignments: stats?.total_assignments ?? 0,
      times_drilled: stats?.times_drilled ?? 0
    },
    study_items: studyItems
  };
});

app.get('/stats/top-words', async () => {
  const rows = sqlite
    .prepare(
      `
      SELECT
        vsis.study_item_id,
        vsis.surface_form,
        vsis.selected_reading,
        vsis.times_completed,
        vsis.total_time_ms,
        vsis.avg_completion_time_ms
      FROM v_study_item_stats vsis
      WHERE vsis.times_completed > 0
      ORDER BY vsis.times_completed DESC, vsis.total_time_ms DESC
      LIMIT 10
      `
    )
    .all() as Array<{
      study_item_id: number;
      surface_form: string;
      selected_reading: string;
      times_completed: number;
      total_time_ms: number;
      avg_completion_time_ms: number | null;
    }>;

  return {
    words: rows.map((row) => ({
      study_item_id: row.study_item_id,
      surface_form: row.surface_form,
      selected_reading: row.selected_reading,
      times_completed: row.times_completed,
      total_time_ms: row.total_time_ms,
      avg_completion_time_ms: Math.round(row.avg_completion_time_ms ?? 0)
    }))
  };
});

app.get('/stats/slowest-words', async () => {
  const rows = sqlite
    .prepare(
      `
      SELECT
        vsis.study_item_id,
        vsis.surface_form,
        vsis.selected_reading,
        vsis.times_completed,
        vsis.total_time_ms,
        vsis.avg_completion_time_ms
      FROM v_study_item_stats vsis
      WHERE vsis.times_completed >= 2 AND vsis.avg_completion_time_ms IS NOT NULL
      ORDER BY vsis.avg_completion_time_ms DESC
      LIMIT 10
      `
    )
    .all() as Array<{
      study_item_id: number;
      surface_form: string;
      selected_reading: string;
      times_completed: number;
      total_time_ms: number;
      avg_completion_time_ms: number | null;
    }>;

  return {
    words: rows.map((row) => ({
      study_item_id: row.study_item_id,
      surface_form: row.surface_form,
      selected_reading: row.selected_reading,
      times_completed: row.times_completed,
      total_time_ms: row.total_time_ms,
      avg_completion_time_ms: Math.round(row.avg_completion_time_ms ?? 0)
    }))
  };
});

app.get('/stats/top-kanji', async () => {
  const rows = sqlite
    .prepare(
      `
      SELECT
        vks.kanji_literal,
        vks.word_count,
        vks.total_assignments,
        vks.times_drilled,
        k.onyomi_json,
        k.kunyomi_json,
        k.stroke_count,
        k.grade
      FROM v_kanji_stats vks
      JOIN kanji k ON k.literal = vks.kanji_literal
      ORDER BY vks.times_drilled DESC, vks.total_assignments DESC
      LIMIT 10
      `
    )
    .all() as Array<{
      kanji_literal: string;
      word_count: number;
      total_assignments: number;
      times_drilled: number;
      onyomi_json: string;
      kunyomi_json: string;
      stroke_count: number;
      grade: number | null;
    }>;

  return {
    kanji: rows.map((row) => ({
      literal: row.kanji_literal,
      word_count: row.word_count,
      total_assignments: row.total_assignments,
      times_drilled: row.times_drilled,
      onyomi: safeJsonParse<string[]>(row.onyomi_json),
      kunyomi: safeJsonParse<string[]>(row.kunyomi_json),
      stroke_count: row.stroke_count,
      grade: row.grade
    }))
  };
});

if (fs.existsSync(appConfig.webDistDir)) {
  app.get('*', async (_request, reply) => {
    return reply.sendFile('index.html');
  });
}

function requestLogSafe(error: unknown): void {
  if (error instanceof Error) {
    app.log.error(error);
    return;
  }
  app.log.error({ error }, 'Unknown error');
}

async function shutdown(signal: string): Promise<void> {
  app.log.info(`Received ${signal}, shutting down...`);
  await app.close();
  sqlite.pragma('wal_checkpoint(TRUNCATE)');
  sqlite.close();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

try {
  await app.listen({ port: appConfig.port, host: appConfig.host });
  app.log.info(`API server listening on http://${appConfig.host}:${appConfig.port}`);
} catch (error) {
  requestLogSafe(error);
  process.exit(1);
}
