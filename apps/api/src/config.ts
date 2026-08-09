import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { envConfigSchema } from '@kanjiscribe/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../../data');

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  kanjiSvgDir: string;
  webDistDir: string;
}

/**
 * Build the api's config snapshot at boot and parse it through the shared
 * env schema (ADR-0006): a malformed variable throws the zod error naming
 * it, aborting startup instead of failing at request time.
 */
export function parseApiConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envConfigSchema.parse(env);
  const dataDir = parsed.KANJISCRIBE_DATA_DIR ?? DEFAULT_DATA_DIR;
  return {
    port: parsed.KANJISCRIBE_API_PORT,
    host: parsed.KANJISCRIBE_API_HOST,
    dataDir,
    dbPath: parsed.KANJISCRIBE_DB_PATH ?? path.join(dataDir, 'kanjiscribe.db'),
    kanjiSvgDir: parsed.KANJI_SVG_DIR ?? path.join(dataDir, 'kanji-svg'),
    webDistDir: path.resolve(__dirname, '../../web/dist')
  };
}

export const appConfig = parseApiConfig(process.env);

/** Today's date as `YYYY-MM-DD` in UTC — the day-key used across the api. */
export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The current instant as a UTC ISO timestamp. */
export function nowIso(): string {
  return new Date().toISOString();
}
