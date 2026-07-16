import { sqlite } from './client.js';
import { runMigrationsOnDb } from './run-migrations.js';

await runMigrationsOnDb(sqlite, true);
console.log('Migrations complete.');
