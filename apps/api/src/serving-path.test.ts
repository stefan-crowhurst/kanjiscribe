import fs from 'node:fs';
import path from 'node:path';

import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { appConfig } from './config.js';

/**
 * The server's serving path, end to end through the single bundled server:
 * the built web frontend is served statically (page loads, its assets
 * resolve), client-side deep links fall back to the app shell, the kanji SVG
 * tree is served under its prefix, CORS keeps the web app's origins and
 * methods working (PUT in particular — queue reordering), and /health
 * answers. The HTTP plugins behind this path take new majors in the
 * dependency refresh; these are the behaviors that must not move.
 */

const WEB_ASSET_NAME = 'serving-fixture.js';
const WEB_ASSET_PATH = `/assets/${WEB_ASSET_NAME}`;
const SVG_FIXTURE_NAME = 'serving-fixture.svg';
const SVG_FIXTURE_BODY = '<svg id="serving-fixture"></svg>';

const createdFiles: string[] = [];
const createdDirs: string[] = [];

function ensureWebDistFixture(): void {
  const indexPath = path.join(appConfig.webDistDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    return;
  }
  const assetsDir = path.join(appConfig.webDistDir, 'assets');
  for (const dir of [appConfig.webDistDir, assetsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir);
      createdDirs.push(dir);
    }
  }
  const assetPath = path.join(assetsDir, WEB_ASSET_NAME);
  fs.writeFileSync(assetPath, "console.log('serving fixture');\n");
  createdFiles.push(assetPath);
  fs.writeFileSync(
    indexPath,
    `<!doctype html>
<html lang="en">
  <head>
    <title>kanjiscribe</title>
    <script type="module" src="${WEB_ASSET_PATH}"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`
  );
  createdFiles.push(indexPath);
}

function ensureKanjiSvgFixture(): { name: string; body: string } {
  const existing = fs.existsSync(appConfig.kanjiSvgDir)
    ? fs.readdirSync(appConfig.kanjiSvgDir).find((file) => file.endsWith('.svg'))
    : undefined;
  if (existing) {
    return {
      name: existing,
      body: fs.readFileSync(path.join(appConfig.kanjiSvgDir, existing), 'utf8')
    };
  }
  if (!fs.existsSync(appConfig.kanjiSvgDir)) {
    fs.mkdirSync(appConfig.kanjiSvgDir, { recursive: true });
    createdDirs.push(appConfig.kanjiSvgDir);
  }
  const fixturePath = path.join(appConfig.kanjiSvgDir, SVG_FIXTURE_NAME);
  fs.writeFileSync(fixturePath, SVG_FIXTURE_BODY);
  createdFiles.push(fixturePath);
  return { name: SVG_FIXTURE_NAME, body: SVG_FIXTURE_BODY };
}

let app: FastifyInstance;
let svg: { name: string; body: string };

beforeAll(async () => {
  ensureWebDistFixture();
  svg = ensureKanjiSvgFixture();
  ({ app } = await import('./server.js'));
});

afterAll(async () => {
  await app.close();
  for (const file of createdFiles) {
    fs.rmSync(file, { force: true });
  }
  for (const dir of [...createdDirs].reverse()) {
    fs.rmdirSync(dir);
  }
});

describe('the single bundled server serves the web app', () => {
  it('serves the app shell at /', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('id="root"');
  });

  it('resolves every asset the app shell references', async () => {
    const page = await app.inject({ method: 'GET', url: '/' });
    const assetPaths = [...page.body.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(assetPaths.length).toBeGreaterThan(0);

    for (const assetPath of assetPaths) {
      const res = await app.inject({ method: 'GET', url: assetPath });
      expect(res.statusCode, `asset ${assetPath} resolves`).toBe(200);
      expect(res.body.length, `asset ${assetPath} has a body`).toBeGreaterThan(0);
    }
  });

  it('falls back to the app shell for client-side deep links', async () => {
    const shell = await app.inject({ method: 'GET', url: '/' });
    const deepLink = await app.inject({ method: 'GET', url: '/day/2024-01-01' });

    expect(deepLink.statusCode).toBe(200);
    expect(deepLink.body).toBe(shell.body);
  });

  it('serves the kanji SVG tree under its prefix', async () => {
    const res = await app.inject({ method: 'GET', url: `/static/kanji-svg/${svg.name}` });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
    expect(res.body).toBe(svg.body);
  });

  it('answers the health endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });
});

describe('CORS keeps working for the web app', () => {
  const origin = 'https://kanjiscribe.test';

  it('reflects the origin on API responses', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { origin }
    });

    expect(res.headers['access-control-allow-origin']).toBe(origin);
  });

  it('keeps the web app methods allowed on preflight, including PUT for queue reordering', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/assignments/2024-01-01/order',
      headers: {
        origin,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type'
      }
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(origin);
    const methods = String(res.headers['access-control-allow-methods'])
      .split(',')
      .map((method) => method.trim().toUpperCase());
    expect(methods.sort()).toEqual(['DELETE', 'GET', 'HEAD', 'PATCH', 'POST', 'PUT']);
    expect(res.headers['access-control-allow-headers']).toContain('content-type');
  });
});
