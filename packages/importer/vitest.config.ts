import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // better-sqlite3 is a native module; the forks pool keeps its handles out
    // of worker threads.
    pool: 'forks'
  }
});
