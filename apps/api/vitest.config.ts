import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defineConfig } from 'vitest/config';

const dbPath = path.join(os.tmpdir(), `kanjiscribe-test-${process.pid}.db`);
fs.rmSync(dbPath, { force: true });
fs.rmSync(`${dbPath}-wal`, { force: true });
fs.rmSync(`${dbPath}-shm`, { force: true });
process.env.KANJISCRIBE_DB_PATH = dbPath;

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    pool: 'forks',
    // Vitest 4 removed `poolOptions`. `poolOptions.forks.singleFork: true`
    // (one fork at a time, fresh child process per test file) is now
    // `maxWorkers: 1` with the default `isolate: true`. The suite shares one
    // test database, so files must run sequentially.
    maxWorkers: 1
  }
});
