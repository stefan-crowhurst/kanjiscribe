import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';

import { registerAssignmentsRoutes } from './assignments/routes.js';
import { appConfig } from './config.js';
import { sqlite } from './db/client.js';
import { runMigrationsOnDb } from './db/run-migrations.js';
import { registerDictionaryRoutes } from './dictionary/routes.js';
import { registerEstimatesRoutes } from './estimates/routes.js';
import { registerIntakeRoutes } from './intake/routes.js';
import { registerStatsRoutes } from './stats/routes.js';

const isEntry = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

async function runMigrationsOnBoot(): Promise<void> {
  await runMigrationsOnDb(sqlite);
}

if (isEntry) {
  await runMigrationsOnBoot();
}

const app = Fastify({ logger: isEntry });

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

registerDictionaryRoutes(app);
registerStatsRoutes(app);
registerEstimatesRoutes(app);
registerIntakeRoutes(app);
registerAssignmentsRoutes(app);

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

if (isEntry) {
  try {
    await app.listen({ port: appConfig.port, host: appConfig.host });
    app.log.info(`API server listening on http://${appConfig.host}:${appConfig.port}`);
  } catch (error) {
    requestLogSafe(error);
    process.exit(1);
  }
}

export { app };
