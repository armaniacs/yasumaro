/**
 * Vitest設定ファイル - TEMP for re-enabling tests
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    include: ['**/__tests__/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/.kilo/**',
      '**/video-*/**',
      // DOM環境依存（jsdom対応待ち）
      'src/popup/__tests__/fieldValidation.test.ts',
      'src/popup/__tests__/focusTrap.test.ts',
      'src/popup/__tests__/ui-ux-improvements.test.ts',
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
    ],
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
    testTimeout: 15000,
    pool: 'forks',
  },
  resolve: {
    alias: {
      'src/': path.resolve(__dirname, './src/'),
    },
  },
  esbuild: {
    target: 'esnext',
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
      },
    },
  },
});
