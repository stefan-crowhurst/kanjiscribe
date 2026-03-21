import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { appConfig } from '../config.js';

type SqliteDatabase = InstanceType<typeof Database>;

const dbDir = path.dirname(appConfig.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const sqlite: SqliteDatabase = new Database(appConfig.dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export type SqliteDb = SqliteDatabase;
