/**
 * Vitest設定ファイル
 * Jestからの移行: TypeScriptネイティブ、ESM対応、高速実行
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',

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
      'src/utils/__tests__/storage-keys.test.ts',
      // DOM環境依存テスト（jsdom/node_modules破損のため一時除外）
      'src/popup/__tests__/fieldValidation.test.ts',
      'src/popup/__tests__/focusTrap.test.ts',
      'src/popup/__tests__/ui-ux-improvements.test.ts',
      'src/utils/__tests__/aiSummaryCleaner.test.ts',
      'src/utils/__tests__/contentCleaner.test.ts',
      'src/popup/__tests__/i18n.test.ts',
      'src/popup/__tests__/integration-reload-workflow.test.ts',
      'src/popup/__tests__/ublockImport-error.test.ts',
      'src/popup/__tests__/ublockImport-rulesBuilder.test.ts',
      'src/popup/__tests__/ublockImport-validation.test.ts',
      'src/popup/__tests__/main.test.ts',
      'src/popup/__tests__/mask-visualization.test.ts',
      'src/popup/__tests__/navigation.test.ts',
      'src/popup/__tests__/trustSettings-xss.test.ts',
      'src/popup/__tests__/ublockImport-uiRenderer.test.ts',
      'src/dashboard/__tests__/**',
      'src/popup/__tests__/aiProvider.test.ts',
      'src/popup/__tests__/autoClose.test.ts',
      'src/popup/__tests__/domainFilter.test.ts',
      'src/popup/__tests__/errorUtils.test.ts',
      'src/popup/__tests__/mainSpinner.test.ts',
      'src/popup/__tests__/popup-xss.test.ts',
      'src/popup/__tests__/sanitizePreview.test.ts',
      'src/popup/__tests__/settingsUiHelper.test.ts',
      'src/popup/__tests__/trustSettings.test.ts',
      'src/popup/__tests__/ublockExport.test.ts',
      'src/popup/__tests__/ublockImport-fileReader.test.ts',
      'src/popup/__tests__/ublockImport-xss.test.ts',
      'src/popup/__tests__/ublockImport.test.ts',
      'src/popup/settings/__tests__/fieldValidation.test.ts',
      'src/popup/ublockImport/__tests__/index.test.ts',
      'src/utils/__tests__/contentExtractor.test.ts',
      'src/utils/__tests__/promptSanitizer-false-positives.test.ts',
      'src/utils/__tests__/promptSanitizer-refined-test.test.ts',
      'src/utils/__tests__/settingsExportImport.test.ts',
      'src/utils/__tests__/trustChecker.test.ts',
      'src/utils/__tests__/trustDb.test.ts',
      'src/utils/trustDb/__tests__/trancoChangeDetector.test.ts',
      'src/utils/trustDb/__tests__/trancoConsentManager.test.ts',
      'src/utils/trustDb/__tests__/trustDb-atomicity.test.ts',
      'src/popup/__tests__/ublockImport-sourceManager.test.ts',
      'src/utils/__tests__/logger-security.test.ts',
      'src/__tests__/manifest.test.ts',
      'src/background/ai/providers/__tests__/prompt-injection-high-blocking.test.ts',
    ],

    // カバレッジ設定
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/__tests__/**',
        'src/**/*.d.ts',
      ],
      all: true,
    },

    // タイムアウト設定（15秒）
    testTimeout: 15000,

    // 並列実行設定 (Vitest 4.x format)
    pool: 'forks',

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
