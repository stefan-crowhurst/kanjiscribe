import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

import Database from 'better-sqlite3';
import { XMLParser } from 'fast-xml-parser';
import sax from 'sax';
import unzipper from 'unzipper';

type ImportDataset = 'jmdict' | 'kanjidic2' | 'kanjivg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../..');

const DATA_DIR = process.env.KANJISCRIBE_DATA_DIR ?? path.resolve(REPO_ROOT, 'data');
const DB_PATH = process.env.KANJISCRIBE_DB_PATH ?? path.join(DATA_DIR, 'kanjiscribe.db');
const SVG_TARGET_DIR = process.env.KANJI_SVG_DIR ?? path.join(DATA_DIR, 'kanji-svg');

const DB_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function nowIso(): string {
  return new Date().toISOString();
}

function ensureMigrations(): void {
  const migrationPath = path.resolve(REPO_ROOT, 'apps/api/src/db/sql/0001_initial.sql');
  if (!fs.existsSync(migrationPath)) {
    throw new Error(`Migration file missing: ${migrationPath}`);
  }
  db.exec(fs.readFileSync(migrationPath, 'utf8'));
}

function readMaybeGzip(filePath: string): string {
  const bytes = fs.readFileSync(filePath);
  if (filePath.endsWith('.gz')) {
    return zlib.gunzipSync(bytes).toString('utf8');
  }
  return bytes.toString('utf8');
}

function beginRun(dataset: ImportDataset, sourceFile: string, sourceVersion: string | null = null): number {
  const result = db
    .prepare(
      `
      INSERT INTO importer_run (dataset, source_version, source_file, started_at, status)
      VALUES (?, ?, ?, ?, 'running')
      `
    )
    .run(dataset, sourceVersion, sourceFile, nowIso());
  return Number(result.lastInsertRowid);
}

function finishRun(
  id: number,
  status: 'completed' | 'failed',
  processed: number,
  failed: number,
  message: string | null = null
): void {
  db.prepare(
    `
    UPDATE importer_run
    SET status = ?, completed_at = ?, records_processed = ?, records_failed = ?, error_message = ?
    WHERE id = ?
    `
  ).run(status, nowIso(), processed, failed, message, id);
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function extractNfRank(tags: string[]): number | null {
  let min: number | null = null;
  for (const tag of tags) {
    const match = /^nf(\d{2})$/.exec(tag);
    if (!match) {
      continue;
    }
    const rank = Number(match[1]);
    if (Number.isNaN(rank)) {
      continue;
    }
    min = min === null ? rank : Math.min(min, rank);
  }
  return min;
}

type ProgressReporter = {
  setStage: (stage: string) => void;
  setCounts: (processed: number, failed: number) => void;
  stopSuccess: (message?: string) => void;
  stopFailure: (message?: string) => void;
};

function createProgressReporter(label: string): ProgressReporter {
  const spinnerFrames = ['|', '/', '-', '\\'];
  const isTty = Boolean(process.stdout.isTTY);
  let stage = 'starting';
  let processed = 0;
  let failed = 0;
  let frameIndex = 0;
  let timer: NodeJS.Timeout | null = null;

  const buildLine = (prefix: string) =>
    `${prefix} ${label} - ${stage} | processed=${processed.toLocaleString()} failed=${failed.toLocaleString()}`;

  const render = () => {
    if (!isTty) {
      return;
    }

    const frame = spinnerFrames[frameIndex % spinnerFrames.length];
    frameIndex += 1;
    process.stdout.write(`\r${buildLine(frame)}`);
  };

  if (isTty) {
    timer = setInterval(render, 120);
    render();
  } else {
    console.log(buildLine('>'));
  }

  return {
    setStage(nextStage) {
      stage = nextStage;
      if (!isTty) {
        console.log(buildLine('>'));
      }
    },
    setCounts(nextProcessed, nextFailed) {
      processed = nextProcessed;
      failed = nextFailed;
    },
    stopSuccess(message) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (isTty) {
        process.stdout.write(`\r${buildLine('✓')}\n`);
      } else {
        console.log(buildLine('✓'));
      }
      if (message) {
        console.log(message);
      }
    },
    stopFailure(message) {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      if (isTty) {
        process.stdout.write(`\r${buildLine('x')}\n`);
      } else {
        console.log(buildLine('x'));
      }
      if (message) {
        console.error(message);
      }
    }
  };
}

function importKanjidic2(sourceFile: string): void {
  const runId = beginRun('kanjidic2', sourceFile);
  const progress = createProgressReporter('KANJIDIC2');
  let processed = 0;
  let failed = 0;

  try {
    progress.setStage('reading source file');
    const xml = readMaybeGzip(sourceFile);
    progress.setStage('parsing XML');
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_'
    });

    const parsed = parser.parse(xml) as {
      kanjidic2?: { character?: unknown };
    };

    const characters = asArray(parsed.kanjidic2?.character as any);
    const insert = db.prepare(
      `
      INSERT INTO kanji (
        literal, meanings_json, onyomi_json, kunyomi_json,
        stroke_count, grade, jlpt_level, frequency_rank
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(literal) DO UPDATE SET
        meanings_json = excluded.meanings_json,
        onyomi_json = excluded.onyomi_json,
        kunyomi_json = excluded.kunyomi_json,
        stroke_count = excluded.stroke_count,
        grade = excluded.grade,
        jlpt_level = excluded.jlpt_level,
        frequency_rank = excluded.frequency_rank
      `
    );

    const tx = db.transaction((chunk: any[]) => {
      for (const character of chunk) {
        try {
          const literal = String(character.literal ?? '').trim();
          if (!literal) {
            failed += 1;
            continue;
          }

          const misc = character.misc ?? {};
          const strokeRaw = asArray(misc.stroke_count)[0];

          const groups = asArray(character.reading_meaning?.rmgroup as any);
          const onyomi: string[] = [];
          const kunyomi: string[] = [];
          const meanings: string[] = [];

          for (const group of groups) {
            const readings = asArray(group.reading as any);
            for (const reading of readings) {
              const text = typeof reading === 'string' ? reading : String(reading['#text'] ?? '').trim();
              const type = typeof reading === 'string' ? '' : String(reading['@_r_type'] ?? '');
              if (!text) {
                continue;
              }
              if (type === 'ja_on') {
                onyomi.push(text);
              }
              if (type === 'ja_kun') {
                kunyomi.push(text);
              }
            }

            const meaningList = asArray(group.meaning as any);
            for (const meaning of meaningList) {
              if (typeof meaning === 'string') {
                meanings.push(meaning);
              } else {
                const lang = String(meaning['@_m_lang'] ?? 'en');
                if (lang === 'en') {
                  meanings.push(String(meaning['#text'] ?? '').trim());
                }
              }
            }
          }

          insert.run(
            literal,
            JSON.stringify(meanings.filter(Boolean)),
            JSON.stringify(onyomi.filter(Boolean)),
            JSON.stringify(kunyomi.filter(Boolean)),
            Number(strokeRaw ?? 0),
            misc.grade ? Number(misc.grade) : null,
            misc.jlpt ? Number(misc.jlpt) : null,
            misc.freq ? Number(misc.freq) : null
          );

          processed += 1;
        } catch {
          failed += 1;
        }
      }
    });

    const chunkSize = 1000;
    progress.setStage('writing kanji rows');
    for (let i = 0; i < characters.length; i += chunkSize) {
      tx(characters.slice(i, i + chunkSize));
      progress.setCounts(processed, failed);
    }

    finishRun(runId, 'completed', processed, failed);
    progress.stopSuccess(`KANJIDIC2 import complete: processed=${processed}, failed=${failed}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishRun(runId, 'failed', processed, failed, message);
    progress.stopFailure(`KANJIDIC2 import failed: ${message}`);
    throw error;
  }
}

type JmEntry = {
  id: number;
  spellings: Array<{ text: string; pri: string[] }>;
  readings: Array<{ text: string; noKanji: boolean; restr: string[]; pri: string[] }>;
  senses: Array<{
    glosses: string[];
    pos: string[];
    misc: string[];
    field: string[];
    dial: string[];
    info: string[];
  }>;
};

function importJmdict(sourceFile: string): Promise<void> {
  const runId = beginRun('jmdict', sourceFile);
  const progress = createProgressReporter('JMdict');
  let processed = 0;
  let failed = 0;

  const insertEntry = db.prepare(
    `
    INSERT INTO dictionary_entry (id, is_common, priority_rank, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      is_common = excluded.is_common,
      priority_rank = excluded.priority_rank,
      updated_at = excluded.updated_at
    `
  );

  const deleteEntrySpellings = db.prepare(`DELETE FROM entry_spelling WHERE entry_id = ?`);
  const deleteEntryReadings = db.prepare(`DELETE FROM entry_reading WHERE entry_id = ?`);
  const deleteEntryRestrictions = db.prepare(`DELETE FROM entry_reading_spelling WHERE entry_id = ?`);
  const deleteEntrySenses = db.prepare(`DELETE FROM entry_sense WHERE entry_id = ?`);

  const insertSpelling = db.prepare(
    `
    INSERT INTO entry_spelling (entry_id, text, is_primary, priority_rank)
    VALUES (?, ?, ?, ?)
    `
  );

  const insertReading = db.prepare(
    `
    INSERT INTO entry_reading (entry_id, text, is_primary, no_kanji)
    VALUES (?, ?, ?, ?)
    `
  );

  const insertReadingSpelling = db.prepare(
    `
    INSERT INTO entry_reading_spelling (entry_id, reading_text, spelling_text)
    VALUES (?, ?, ?)
    `
  );

  const insertSense = db.prepare(
    `
    INSERT INTO entry_sense (
      entry_id,
      sense_index,
      glosses_json,
      parts_of_speech_json,
      misc_tags_json,
      field_tags_json,
      dialect_tags_json,
      info_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  );

  const flushEntries = db.transaction((entries: JmEntry[]) => {
    const now = nowIso();
    const commonTagSet = new Set(['news1', 'ichi1', 'spec1', 'spec2', 'gai1']);

    for (const entry of entries) {
      try {
        const allPri = [...entry.spellings.flatMap((s) => s.pri), ...entry.readings.flatMap((r) => r.pri)];
        const isCommon = allPri.some((tag) => commonTagSet.has(tag));
        const entryPriority = extractNfRank(allPri);

        insertEntry.run(entry.id, isCommon ? 1 : 0, entryPriority, now, now);
        deleteEntryRestrictions.run(entry.id);
        deleteEntryReadings.run(entry.id);
        deleteEntrySpellings.run(entry.id);
        deleteEntrySenses.run(entry.id);

        entry.spellings.forEach((spelling, index) => {
          insertSpelling.run(entry.id, spelling.text, index === 0 ? 1 : 0, extractNfRank(spelling.pri));
        });

        entry.readings.forEach((reading, index) => {
          insertReading.run(entry.id, reading.text, index === 0 ? 1 : 0, reading.noKanji ? 1 : 0);
          for (const restrictedSpelling of reading.restr) {
            insertReadingSpelling.run(entry.id, reading.text, restrictedSpelling);
          }
        });

        entry.senses.forEach((sense, index) => {
          insertSense.run(
            entry.id,
            index,
            JSON.stringify(sense.glosses),
            JSON.stringify(sense.pos),
            JSON.stringify(sense.misc),
            JSON.stringify(sense.field),
            JSON.stringify(sense.dial),
            JSON.stringify(sense.info)
          );
        });

        processed += 1;
      } catch {
        failed += 1;
      }
    }
  });

  return new Promise((resolve, reject) => {
    try {
      progress.setStage('reading source file');
      const xmlBuffer = fs.readFileSync(sourceFile);
      const xml = sourceFile.endsWith('.gz') ? zlib.gunzipSync(xmlBuffer) : xmlBuffer;
      progress.setStage('streaming dictionary entries');
      const stream = sax.createStream(false, { trim: true, lowercase: true });
      let settled = false;

      const failImport = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        finishRun(runId, 'failed', processed, failed, error.message);
        progress.setCounts(processed, failed);
        progress.stopFailure(`JMdict import failed: ${error.message}`);
        reject(error);
      };

      const completeImport = () => {
        if (settled) {
          return;
        }
        settled = true;
        progress.setStage('finalizing import');
        flushIfNeeded(true);
        finishRun(runId, 'completed', processed, failed);
        progress.setCounts(processed, failed);
        progress.stopSuccess(`JMdict import complete: processed=${processed}, failed=${failed}`);
        resolve();
      };

      let entriesBuffer: JmEntry[] = [];
      const flushIfNeeded = (force = false) => {
        if (!force && entriesBuffer.length < 1000) {
          return;
        }
        if (entriesBuffer.length === 0) {
          return;
        }
        const toFlush = entriesBuffer;
        entriesBuffer = [];
        flushEntries(toFlush);
        progress.setCounts(processed, failed);
      };

      let currentEntry: JmEntry | null = null;
      let currentSpelling: { text: string; pri: string[] } | null = null;
      let currentReading: { text: string; noKanji: boolean; restr: string[]; pri: string[] } | null = null;
      let currentSense: JmEntry['senses'][number] | null = null;
      let currentText = '';

      stream.on('opentag', (node) => {
        currentText = '';

        if (node.name === 'entry') {
          currentEntry = { id: 0, spellings: [], readings: [], senses: [] };
        }
        if (node.name === 'k_ele') {
          currentSpelling = { text: '', pri: [] };
        }
        if (node.name === 'r_ele') {
          currentReading = { text: '', noKanji: false, restr: [], pri: [] };
        }
        if (node.name === 'sense') {
          currentSense = {
            glosses: [],
            pos: [],
            misc: [],
            field: [],
            dial: [],
            info: []
          };
        }
      });

      stream.on('text', (text) => {
        currentText += text;
      });

      stream.on('closetag', (name) => {
        const value = currentText.trim();

        if (!currentEntry) {
          currentText = '';
          return;
        }

        if (name === 'ent_seq' && value) {
          currentEntry.id = Number(value);
        }

        if (currentSpelling) {
          if (name === 'keb' && value) {
            currentSpelling.text = value;
          }
          if (name === 'ke_pri' && value) {
            currentSpelling.pri.push(value);
          }
          if (name === 'k_ele') {
            if (currentSpelling.text) {
              currentEntry.spellings.push(currentSpelling);
            }
            currentSpelling = null;
          }
        }

        if (currentReading) {
          if (name === 'reb' && value) {
            currentReading.text = value;
          }
          if (name === 're_pri' && value) {
            currentReading.pri.push(value);
          }
          if (name === 're_restr' && value) {
            currentReading.restr.push(value);
          }
          if (name === 're_nokanji') {
            currentReading.noKanji = true;
          }
          if (name === 'r_ele') {
            if (currentReading.text) {
              currentEntry.readings.push(currentReading);
            }
            currentReading = null;
          }
        }

        if (currentSense) {
          if (name === 'gloss' && value) {
            currentSense.glosses.push(value);
          }
          if (name === 'pos' && value) {
            currentSense.pos.push(value);
          }
          if (name === 'misc' && value) {
            currentSense.misc.push(value);
          }
          if (name === 'field' && value) {
            currentSense.field.push(value);
          }
          if (name === 'dial' && value) {
            currentSense.dial.push(value);
          }
          if (name === 's_inf' && value) {
            currentSense.info.push(value);
          }
          if (name === 'sense') {
            currentEntry.senses.push(currentSense);
            currentSense = null;
          }
        }

        if (name === 'entry') {
          if (currentEntry.id > 0) {
            entriesBuffer.push(currentEntry);
            flushIfNeeded();
          }
          currentEntry = null;
        }

        currentText = '';
      });

      stream.on('error', failImport);

      stream.on('end', () => {
        completeImport();
      });

      try {
        stream.end(xml);
      } catch (error) {
        failImport(error instanceof Error ? error : new Error(String(error)));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finishRun(runId, 'failed', processed, failed, message);
      progress.setCounts(processed, failed);
      progress.stopFailure(`JMdict import failed: ${message}`);
      reject(error);
    }
  });
}

async function importKanjiVg(sourcePath: string, sourceVersion = 'unknown'): Promise<void> {
  const runId = beginRun('kanjivg', sourcePath, sourceVersion);
  const progress = createProgressReporter('KanjiVG');
  let processed = 0;
  let failed = 0;

  fs.mkdirSync(SVG_TARGET_DIR, { recursive: true });

  const upsertAsset = db.prepare(
    `
    INSERT INTO kanji_stroke_asset (kanji_literal, asset_path, source_version, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(kanji_literal) DO UPDATE SET
      asset_path = excluded.asset_path,
      source_version = excluded.source_version,
      updated_at = excluded.updated_at
    `
  );

  const hasKanji = db.prepare(`SELECT literal FROM kanji WHERE literal = ?`);

  const saveSvg = (filename: string, content: Buffer) => {
    const hex = path.basename(filename, '.svg').toLowerCase();
    if (!/^[0-9a-f]{5}$/.test(hex)) {
      return;
    }

    const codePoint = Number.parseInt(hex, 16);
    const literal = String.fromCodePoint(codePoint);
    const exists = hasKanji.get(literal);
    if (!exists) {
      return;
    }

    const outputName = `${hex}.svg`;
    const outputPath = path.join(SVG_TARGET_DIR, outputName);
    fs.writeFileSync(outputPath, content);

    upsertAsset.run(literal, `kanji-svg/${outputName}`, sourceVersion, nowIso());
    processed += 1;
    progress.setCounts(processed, failed);
  };

  try {
    if (sourcePath.endsWith('.zip')) {
      progress.setStage('reading zip archive');
      const directory = await unzipper.Open.file(sourcePath);
      progress.setStage('extracting SVG assets');
      for (const file of directory.files) {
        const match = /(?:^|\/)kanji\/([0-9a-fA-F]{5}\.svg)$/.exec(file.path);
        if (!match) {
          continue;
        }

        const svgFilename = match[1];
        if (!svgFilename) {
          continue;
        }

        try {
          const content = await file.buffer();
          saveSvg(svgFilename, content);
        } catch {
          failed += 1;
          progress.setCounts(processed, failed);
        }
      }
    } else {
      progress.setStage('reading SVG directory');
      const files = fs.readdirSync(sourcePath);
      progress.setStage('copying SVG assets');
      for (const file of files) {
        if (!/^[0-9a-fA-F]{5}\.svg$/.test(file)) {
          continue;
        }
        try {
          const content = fs.readFileSync(path.join(sourcePath, file));
          saveSvg(file, content);
        } catch {
          failed += 1;
          progress.setCounts(processed, failed);
        }
      }
    }

    finishRun(runId, 'completed', processed, failed);
    progress.stopSuccess(`KanjiVG import complete: processed=${processed}, failed=${failed}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    finishRun(runId, 'failed', processed, failed, message);
    progress.stopFailure(`KanjiVG import failed: ${message}`);
    throw error;
  }
}

async function main() {
  ensureMigrations();
  const [command, ...rest] = process.argv.slice(2);

  if (!command) {
    console.log('Usage:');
    console.log('  import:kanjidic2 <path-to-kanjidic2.xml|.gz>');
    console.log('  import:jmdict <path-to-jmdict.xml|.gz>');
    console.log('  import:kanjivg <path-to-zip-or-kanji-dir> [sourceVersion]');
    process.exit(1);
  }

  try {
    if (command === 'import:kanjidic2') {
      const [sourceFile] = rest;
      if (!sourceFile) {
        throw new Error('Missing source file for KANJIDIC2 import');
      }
      importKanjidic2(path.resolve(sourceFile));
      return;
    }

    if (command === 'import:jmdict') {
      const [sourceFile] = rest;
      if (!sourceFile) {
        throw new Error('Missing source file for JMdict import');
      }
      await importJmdict(path.resolve(sourceFile));
      return;
    }

    if (command === 'import:kanjivg') {
      const [sourcePath, sourceVersion] = rest;
      if (!sourcePath) {
        throw new Error('Missing source path for KanjiVG import');
      }
      await importKanjiVg(path.resolve(sourcePath), sourceVersion);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    db.close();
  }
}

await main();
