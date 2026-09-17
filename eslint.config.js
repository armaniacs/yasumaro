import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import vitestPlugin from '@vitest/eslint-plugin';
import localPlugin from './eslint/plugin.mjs';

export default [
  {
    ignores: ['node_modules/', 'dist/', 'testDir/', 'coverage/', '.vulnhunter-fix/', 'graphify-out/', 'obsidian-smart-history_VULNHUNT_RESULTS*/', '.kilo/', '.claude/'],
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/utils/logger.ts', 'src/**/__tests__/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: process.cwd(),
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      local: localPlugin,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'local/require-sanitized-markdown': 'error',
      'local/require-response-size-limit': 'error',
      // PBI 2026-09-17-05: enforce src/utils/ layer boundaries (Layer 0
      // purity, Layer 1 -> Layer 2 static import ban). Layer lists are the
      // SSOT in eslint/rules/utils-layer-boundary.mjs; see
      // dev-docs/LAYERS.md "Mechanical enforcement". The single allow entry
      // below is provisional per ADR 2026-09-17-defaults-cleansing-rules-provisional-allow
      // (value derivation only; re-review on its retrigger conditions) — see LAYERS.md.
      'local/utils-layer-boundary': [
        'error',
        {
          allow: [
            {
              from: 'src/utils/storage/defaults.ts',
              to: 'src/utils/aiSummaryCleaner/rules',
              reason:
                'PROVISIONAL (PBI 05): DEFAULT_SETTINGS bundles cleansing thresholds from the SSOT rule table. Duplicating the table would reintroduce drift; follow-up ADR needed (extract pure constants or reclassify).',
            },
          ],
        },
      ],
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              // Wave 4 (PBI 2026-09-05-03): logger barrel split. New code
              // imports logger/* directly; the barrel stays as a shim for the
              // existing call sites until they migrate.
              group: ['**/logger.js'],
              message: 'Use direct module imports instead (e.g., from ./logger/core.js or ./logger/api.js). See dev-docs/LAYERS.md Wave 4.',
            },
          ],
          paths: [
            {
              name: '../../utils/storage.js',
              message: 'Use direct module imports instead (e.g., from ./storage/types.js or ./storage/settingsStore.js). See dev-docs/LAYERS.md Wave 3.',
            },
            {
              name: '../utils/storage.js',
              message: 'Use direct module imports instead (e.g., from ../utils/storage/types.js). See dev-docs/LAYERS.md Wave 3.',
            },
            {
              name: './storage.js',
              message: 'Use direct module imports instead. See dev-docs/LAYERS.md Wave 3.',
            },
            {
              name: 'src/utils/storage.js',
              message: 'Use direct module imports instead. See dev-docs/LAYERS.md Wave 3.',
            },
          ],
        },
      ],
    },
  },
  {
    // PBI 2026-09-17-06: forbid direct `new SettingsRepository()` outside the
    // storage seam (singleton definition) and the DI composition root.
    // Reads go through the `settingsRepository` singleton or an injected
    // `SettingsReader`; writes go through the singleton. Direct instantiation
    // splits the 1s TTL settings cache per instance and bypasses the InMemory
    // port injected in tests (the new instance touches real chrome.storage).
    // Observer parity holds either way (observe delegates to port.onChanged),
    // so this rule only removes the split-cache / real-storage hazards.
    // Allowed paths below are the minimal exclusion set; every other
    // production call site must use the singleton or an injected reader.
    files: ['src/**/*.ts'],
    ignores: [
      // Singleton definition itself (+ internal port/adapter uses).
      'src/utils/storage/**/*.ts',
      // `new SettingsRepository(InMemoryStoragePort)` is the canonical test seam.
      'src/**/__tests__/**/*.ts',
      // DI composition root: the factory that builds the singleton once.
      'src/background/compositionManifest.ts',
    ],
    languageOptions: {
      parser: tsParser,
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='SettingsRepository']",
          message:
            'Do not instantiate SettingsRepository directly. Use the settingsRepository singleton or an injected SettingsReader.',
        },
      ],
    },
  },
  {
    // PBI 2026-09-05-21: background → UI 層への上向き依存を禁止。
    // 同意ロジックは src/utils/storage/privacyConsent.ts の中立層に配置済み。
    files: ['src/background/**/*.ts'],
    ignores: ['src/**/__tests__/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      'no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              // Wave 4 と同様: barrel ではなく直接 import を推奨
              group: ['**/logger.js'],
              message: 'Use direct module imports instead (e.g., from ./logger/core.js or ./logger/api.js). See dev-docs/LAYERS.md Wave 4.',
            },
            {
              group: ['**/popup/*', '**/popup.js', '**/dashboard/*', '**/dashboard.js'],
              message: 'background 層から UI 層 (popup/dashboard) への import は禁止。共有ロジックは src/utils/ の中立層に配置すること。See dev-docs/LAYERS.md.',
            },
          ],
          paths: [
            {
              name: '../../utils/storage.js',
              message: 'Use direct module imports instead (e.g., from ./storage/types.js or ./storage/settingsStore.js). See dev-docs/LAYERS.md Wave 3.',
            },
            {
              name: '../utils/storage.js',
              message: 'Use direct module imports instead (e.g., from ../utils/storage/types.js). See dev-docs/LAYERS.md Wave 3.',
            },
            {
              name: './storage.js',
              message: 'Use direct module imports instead. See dev-docs/LAYERS.md Wave 3.',
            },
            {
              name: 'src/utils/storage.js',
              message: 'Use direct module imports instead. See dev-docs/LAYERS.md Wave 3.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/utils/logger.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: process.cwd(),
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      local: localPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'local/require-sanitized-markdown': 'error',
      'local/require-response-size-limit': 'error',
    },
  },
  {
    files: ['**/*.ts'],
    ignores: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // dev-docs/TEST_RULE.md: AIが生成する無意味なテストの検出用。
    files: ['src/**/__tests__/**/*.ts'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      vitest: vitestPlugin,
      local: localPlugin,
    },
    rules: {
      // testPiiDetection (piiSanitizer-optimization.test.ts) wraps the real
      // expect() calls, so it must count as an assertion for this rule.
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'testPiiDetection'] }],
      'vitest/valid-expect': 'error',
      'no-self-compare': 'error',
      'local/no-tautology-expect': 'error',
    },
  },
];
