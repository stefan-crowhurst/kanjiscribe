import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = process.env.KANJISCRIBE_DATA_DIR ?? path.resolve(__dirname, '../../../data');

export const appConfig = {
  port: Number(process.env.KANJISCRIBE_API_PORT ?? 3000),
  host: process.env.KANJISCRIBE_API_HOST ?? '0.0.0.0',
  dbPath: process.env.KANJISCRIBE_DB_PATH ?? path.join(dataDir, 'kanjiscribe.db'),
  kanjiSvgDir: process.env.KANJI_SVG_DIR ?? path.join(dataDir, 'kanji-svg'),
  webDistDir: path.resolve(__dirname, '../../web/dist')
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
