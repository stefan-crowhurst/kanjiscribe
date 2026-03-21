import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const appConfig = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? path.resolve(__dirname, '../../../data/kanjiscribe.db'),
  kanjiSvgDir: process.env.KANJI_SVG_DIR ?? path.resolve(__dirname, '../../../data/kanji-svg'),
  webDistDir: path.resolve(__dirname, '../../web/dist')
};

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}
