/**
 * @deprecated This config is re-exported by the root vitest.config.ts.
 * Do not reference this file directly. Make changes here, and the root
 * config will pick them up automatically.
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

const projectRoot = path.resolve(__dirname, '..');

export default defineConfig({
  test: {
    root: projectRoot,
    environment: 'node',
    setupFiles: ['./testDir/vitest.setup'],
    globals: true,
    include: ['**/__tests__/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/testDir/e2e/**',
      '**/.kilo/**',
      '**/.claude/**',
      '**/video-*/**',
      '**/.vulnhunter-fix/**',
      '**/obsidian-smart-history_VULNHUNT_RESULTS*/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/**/*.d.ts',
        // Entry points bootstrapped from HTML; not imported by unit tests
        'src/dashboard/main.ts',
        'src/popup/main.ts',
        // DOM panel rendering layer; verified via Playwright E2E instead
        'src/dashboard/panels/**',
        // OPFS / Web Worker backends that run in a worker thread
        'src/offscreen/opfsWorker/**',
        'src/offscreen/opfsWorker.ts',
        'src/offscreen/OpfsWorkerBackend.ts',
        'src/offscreen/IdbVfsBackend.ts',
        'src/offscreen/FallbackStorageAdapter.ts',
        'src/offscreen/opfsMigrationV2Reader.ts',
        'src/offscreen/opfsSpike.ts',
        // Wiring/bootstrap modules without unit tests
        'src/background/confirmTokenManager.ts',
        'src/background/dashboardSqliteWiring.ts',
        'src/dashboard/BrowsingLogRepository.ts',
        'src/dashboard/markdownTemplateManager.ts',
      ],
      all: true,
      thresholds: {
        lines: 80,
        branches: 80,
      },
    },
    testTimeout: 15000,
    pool: 'forks',
    // PBI 18: uncapped forks (~20 on this machine) starve timing-sensitive
    // tests (rate-limit windows, perf-ratio assertions, 11s real backoff vs
    // 15s timeout). Capping to 8 removes the contention that triggered the
    // intermittent failures; full-suite wall time is within ~10% of uncapped.
    poolOptions: {
      forks: {
        maxForks: 8,
      },
    },
  },
  resolve: {
    alias: {
      'src/': path.resolve(projectRoot, 'src/'),
    },
  },
});
