import { sqlite } from './db/client.js';
import { runMigrationsOnDb } from './db/run-migrations.js';

runMigrationsOnDb(sqlite);

export { sqlite };