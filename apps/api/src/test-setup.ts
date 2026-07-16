import { sqlite } from './db/client.js';
import { runMigrationsOnDb } from './db/run-migrations.js';

await runMigrationsOnDb(sqlite);

export { sqlite };