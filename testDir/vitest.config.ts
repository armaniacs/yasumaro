/**
 * Vitest設定ファイル
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
    include: ['**/__tests__/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/testDir/e2e/**',
      '**/.kilo/**',
      '**/video-*/**',
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
      ],
      all: true,
    },
    testTimeout: 15000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      'src/': path.resolve(projectRoot, 'src/'),
    },
  },
});
