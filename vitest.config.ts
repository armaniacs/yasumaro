/**
 * Vitest設定ファイル
 * Jestからの移行: TypeScriptネイティブ、ESM対応、高速実行
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // テスト環境: jsdom（ブラウザAPIを必要とするテスト用）
    environment: 'jsdom',

    // セットアップファイル
    setupFiles: ['./vitest.setup.ts'],

    // グローバルAPI（describe, it, expect等）を有効化
    globals: true,

    // テストファイルパターン
    include: ['**/__tests__/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/.kilo/**',
      '**/video-*/**',
    ],

    // カバレッジ設定
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/**/*.d.ts',
      ],
    },

    // タイムアウト設定（15秒）
    testTimeout: 15000,

    // 並列実行設定 (Vitest 4.x format)
    pool: 'threads',
    threads: {
      maxThreads: 4,
      minThreads: 1,
    },
  },

  // モジュール解決
  resolve: {
    alias: {
      'src/': path.resolve(__dirname, './src/'),
    },
  },

  // TypeScript設定
  esbuild: {
    target: 'esnext',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
      },
    },
  },
});
