import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import vitestPlugin from '@vitest/eslint-plugin';
import localPlugin from './eslint/plugin.mjs';

export default [
  {
    ignores: ['node_modules/', 'dist/', 'coverage/', '.vulnhunter-fix/', 'graphify-out/', 'obsidian-smart-history_VULNHUNT_RESULTS*/', '.kilo/', '.claude/'],
  },
  {
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**'],
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
          patterns: [],
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
      // testPiiDetection (piiSanitizer-optimization.test.ts) and expectParity
      // (extended-patterns-parity.test.ts) wrap the real expect() calls, so
      // they must count as assertions for this rule.
      'vitest/expect-expect': ['error', { assertFunctionNames: ['expect', 'testPiiDetection', 'expectParity'] }],
      'vitest/valid-expect': 'error',
      'no-self-compare': 'error',
      'local/no-tautology-expect': 'error',
      // A sleep cannot fail, so it only costs wall time. Wait for a condition
      // instead; see dev-docs/ADR/2026-09-26-test-suite-execution-time-contract.md
      // PBI 2026-09-26-05 cleared the 40 literal violations. The rule resolves
      // const-bound delays too, which surfaced 3 more in privacyPipeline.test.ts;
      // those measure the sleep itself and are opted out with a reason.
      'local/no-test-sleep': 'error',
      // A wait whose only condition is a negative assertion resolves on the
      // callback's first synchronous evaluation, so it asserts its own
      // precondition and cannot detect a missing guard. See
      // dev-docs/TEST_RULE.md § 実時間待ちの禁止と代替手段
      'local/no-vacuous-negative-wait': 'error',
      // Migration warning, not an error: vi.useFakeTimers() with the default
      // toFake replaces setImmediate/queueMicrotask and hangs any dynamic
      // import awaited under it. 124 pre-existing call sites still use it, so
      // promoting this to 'error' would break the build for untouched code.
      'local/no-greedy-fake-timers': 'warn',
    },
  },
  {
    // PBI 2026-09-26-08: testDir/ used to be listed in the global ignores, so
    // Playwright's fixed-duration wait accumulated 12 violations that no tool
    // could see; bench/ was linted but had no rule covering this. `no-fixed-wait`
    // is the E2E counterpart of local/no-test-sleep.
    //
    // Deliberately NOT type-aware: testDir/tsconfig.json includes only
    // `./e2e/fixtures/**` and the vitest test files, not the `.spec.ts` files,
    // so a project-based parser would fail to resolve every spec. Type checking
    // of test code stays with `npm run type-check:test`, which owns its own
    // tsconfig. Extending lint scope must not drag the E2E specs into a
    // half-configured type-aware project — that would break src/**'s
    // `project: './tsconfig.json'` resolution in the same flat config.
    files: ['testDir/**/*.{ts,js,mjs}', 'bench/**/*.{ts,js,mjs}'],
    plugins: {
      local: localPlugin,
    },
    rules: {
      'local/no-fixed-wait': 'error',
    },
  },
  {
    // Browser-served fixture pages under testDir/e2e/test-pages/ are loaded by
    // the page (never bundled), so they keep a .js extension while carrying
    // TypeScript syntax. Without the TS parser they fail to parse at all.
    files: ['testDir/e2e/test-pages/**/*.js'],
    languageOptions: {
      parser: tsParser,
    },
  },
];
