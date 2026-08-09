import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseApiConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_DATA_DIR = path.resolve(__dirname, '../../../data');

describe('parseApiConfig', () => {
  it('applies the existing defaults when env vars are absent', () => {
    const config = parseApiConfig({});

    expect(config.port).toBe(3000);
    expect(config.host).toBe('0.0.0.0');
    expect(config.dataDir).toBe(DEFAULT_DATA_DIR);
    expect(config.dbPath).toBe(path.join(DEFAULT_DATA_DIR, 'kanjiscribe.db'));
    expect(config.kanjiSvgDir).toBe(path.join(DEFAULT_DATA_DIR, 'kanji-svg'));
    expect(config.webDistDir).toBe(path.resolve(__dirname, '../../web/dist'));
  });

  it('parses valid env values, coercing the port to a number', () => {
    const config = parseApiConfig({
      KANJISCRIBE_API_PORT: '8080',
      KANJISCRIBE_API_HOST: '127.0.0.1',
      KANJISCRIBE_DATA_DIR: '/tmp/kanjiscribe-data',
      KANJISCRIBE_DB_PATH: '/tmp/kanjiscribe-data/custom.db',
      KANJI_SVG_DIR: '/tmp/kanjiscribe-data/svg'
    });

    expect(config.port).toBe(8080);
    expect(config.host).toBe('127.0.0.1');
    expect(config.dataDir).toBe('/tmp/kanjiscribe-data');
    expect(config.dbPath).toBe('/tmp/kanjiscribe-data/custom.db');
    expect(config.kanjiSvgDir).toBe('/tmp/kanjiscribe-data/svg');
    expect(config.webDistDir).toBe(path.resolve(__dirname, '../../web/dist'));
  });

  it('aborts on a non-numeric port, naming the variable', () => {
    expect(() => parseApiConfig({ KANJISCRIBE_API_PORT: 'not-a-port' })).toThrow(/KANJISCRIBE_API_PORT/);
  });

  it('aborts on a non-integer or non-positive port, naming the variable', () => {
    expect(() => parseApiConfig({ KANJISCRIBE_API_PORT: '3000.5' })).toThrow(/KANJISCRIBE_API_PORT/);
    expect(() => parseApiConfig({ KANJISCRIBE_API_PORT: '-1' })).toThrow(/KANJISCRIBE_API_PORT/);
  });

  it('aborts on blank host or path values, naming the variable', () => {
    expect(() => parseApiConfig({ KANJISCRIBE_API_HOST: '   ' })).toThrow(/KANJISCRIBE_API_HOST/);
    expect(() => parseApiConfig({ KANJISCRIBE_DB_PATH: '' })).toThrow(/KANJISCRIBE_DB_PATH/);
    expect(() => parseApiConfig({ KANJI_SVG_DIR: '   ' })).toThrow(/KANJI_SVG_DIR/);
  });
});
