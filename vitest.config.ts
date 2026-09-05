import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './tests/stubs/server-only.ts'),
    },
  },
  test: {
    globals: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['./vitest.setup.ts', './tests/setup-integration.ts'],
          testTimeout: 20_000,
          // The beforeAll hook installs the Supabase stubs and runs migrations
          // in a child process. Vitest's 10s default is not enough for that on
          // a cold database, and when it trips the whole file fails in setup
          // with "Hook timed out" and no clue that migrations were the cause.
          hookTimeout: 60_000,
          // Integration tests share one Postgres DB on :54322. Running
          // them in parallel causes TRUNCATE-vs-INSERT deadlocks and
          // FK violations as state from one test leaks into another.
          // Force serial execution: one file at a time, one test at a time.
          fileParallelism: false,
          sequence: { concurrent: false },
        },
      },
    ],
  },
})
