/**
 * @deprecated This config is re-exported by the root vitest.config.ts.
 * Do not reference this file directly. Make changes here, and the root
 * config will pick them up automatically.
 */

import { defineConfig } from 'vitest/config';
import os from 'os';
import path from 'path';
import { partitionTestFiles } from './testPartition';

const projectRoot = path.resolve(__dirname, '..');

/**
 * Worker count for the fork pool.
 *
 * `VITEST_MAX_WORKERS` wins outright so a constrained runner can trade wall
 * time back for the memory headroom the default buys. An unusable value is
 * ignored rather than propagated, because `maxWorkers: 0` would hang the run
 * instead of failing it.
 */
function resolveMaxWorkers(): number {
    const override = Number.parseInt(process.env.VITEST_MAX_WORKERS ?? '', 10);
    if (Number.isInteger(override) && override > 0) return override;
    return Math.max(1, os.availableParallelism() - 2);
}

const include = ['**/__tests__/**/*.test.ts', 'tests/**/*.test.ts'];
const exclude = [
  '**/node_modules/**',
  '**/dist/**',
  '**/testDir/e2e/**',
  '**/.kilo/**',
  '**/.claude/**',
  '**/video-*/**',
  '**/.vulnhunter-fix/**',
  '**/obsidian-smart-history_VULNHUNT_RESULTS*/**',
];
const { shared } = partitionTestFiles(projectRoot, include, exclude);

export default defineConfig({
  test: {
    root: projectRoot,
    environment: 'node',
    setupFiles: ['./testDir/vitest.setup'],
    globals: true,
    // include/exclude live only on the projects: `extends: true` concatenates
    // arrays, so a root-level include would leak every file into `shared`.
    projects: [
      {
        extends: true,
        test: { name: 'isolated', include, exclude: [...exclude, ...shared] },
      },
      {
        extends: true,
        // See testPartition.ts for which files qualify and why.
        test: { name: 'shared', include: shared, exclude, isolate: false },
      },
    ],
    // PBI 2026-09-06-05 spike F-2: real sqlite-wasm (memory storage) needs the
    // .wasm asset served as a file, not via Vite's URL transform.
    assetsInclude: ['**/*.wasm'],
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
    // 30s: `make clean test` runs the full 746-file suite with max forks —
    // under that load, crypto/timer tests (PBKDF2, real setTimeout waits)
    // exceed 15s even though they pass in <1s in isolation. The margin is
    // for suite-level load, not for hiding hangs: genuine hangs still time
    // out at 30s (PBI 2026-09-15 arch-loop Phase 3, 7 timeout flakes under
    // `make clean test` with all 7 green in isolation).
    testTimeout: 30000,
    // forks, not threads: threads measured ~7% faster once, but another run
    // stalled for 30+ min on a thread worker that would not terminate; a
    // stuck fork can be killed.
    pool: 'forks',
    // Cores - 2 rather than Vitest's cores - 1, for peak memory: the isolate
    // project forks once per file and a full run peaked around 6GB of node RSS
    // on a 16GB machine, where one run died with
    // `[vitest-pool-runner]: Timeout waiting for worker to respond`.
    //
    // The wall cost is real and is NOT covered by the ADR's 4/8/12-worker table,
    // which was measured where >=4 workers already saturate the machine. Same
    // 8-core box, full suite: 6 workers 76.9s, 3 workers 184s, 2 workers 303s
    // (CPU utilisation 277% -> 168%). `ubuntu-latest` is 4 vCPU, so CI moves
    // 3 -> 2 workers, and a 2-core runner floors at 1 and serialises everything.
    // VITEST_MAX_WORKERS overrides the formula, which is how CI restores
    // parallelism without editing this file.
    maxWorkers: resolveMaxWorkers(),
  },
  resolve: {
    alias: {
      'src/': path.resolve(projectRoot, 'src/'),
    },
  },
});
