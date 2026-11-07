import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import vitestPlugin from '@vitest/eslint-plugin';
import localPlugin from './eslint/plugin.mjs';

export default [
  {
    ignores: ['node_modules/', 'dist/', 'coverage/', '.vulnhunter-fix/', 'graphify-out/', 'obsidian-smart-history_VULNHUNT_RESULTS*/', '.kilo/', '.claude/', '.worktrees/'],
  },
  {
    // wasm-bindgen emits `/* eslint-disable */` into the glue it generates, and
    // the committed copies under src/wasm/ are byte-gated against a fresh build
    // by CI's wasm-test job (node scripts/wasm-crates.mjs check). Editing that
    // banner out ― even to silence an unused-directive warning ― makes the gate
    // fail: 7f201080 removed it from textrank/sentence-dedup on 2026-10-03 and
    // the job stayed red until it was restored on 2026-10-12. Generated files
    // must round-trip, so the directive is left alone and unused-directive
    // reporting is off for these two files only.
    files: ['src/wasm/**/*.d.ts'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
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
      // (value derivation only; re-review on its retrigger conditions) ― see LAYERS.md.
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
    // PBI 2026-11-07-02: reject NEW direct `chrome.storage.local` get/set
    // outside the SettingsRepository/StoragePort seam. The seam itself
    // (src/utils/storage/**, src/utils/ports.ts) passes by construction
    // inside the rule; every other pre-existing direct use below carries a
    // reason. Entries marked "migration candidate" are settings-shaped
    // stores a follow-up PBI may move into SettingsRepository; the rest
    // (migration, session, queue, crypto, engine, diagnostics) stay direct.
    files: ['src/**/*.ts'],
    ignores: ['src/**/__tests__/**'],
    languageOptions: {
      parser: tsParser,
    },
    plugins: {
      local: localPlugin,
    },
    rules: {
      'local/no-raw-storage': [
        'error',
        {
          allow: [
            {
              file: 'src/background/migration/migrationState.ts',
              reason:
                'Migration state machine (status/progress/retryCount) must work before and while settings migrate; not user settings.',
            },
            {
              file: 'src/background/migration/legacyMigration.ts',
              reason:
                'One-shot legacy browsing-data migration: reads/removes legacy keys once, never a settings round-trip.',
            },
            {
              file: 'src/background/migration/opfsRecovery.ts',
              reason:
                'OPFS fallback recovery owns its fallback-mode/data keys; storage-engine repair, not settings.',
            },
            {
              file: 'src/background/sessionStore.ts',
              reason:
                'Session persistence: emergency flush, single-key session migration, startup bulk move. Session infra, not settings.',
            },
            {
              file: 'src/background/queueStorageAdapter.ts',
              reason:
                'Offline queue load/save behind an injectable QueueStorageAdapter seam; queue infra, not settings.',
            },
            {
              file: 'src/background/recordingPause.ts',
              reason:
                'Pause-until timestamp behind an injectable PauseStorage seam; session-scoped ephemeral state, not user settings.',
            },
            {
              file: 'src/background/recordingTriggerManager.ts',
              reason:
                'Migration-compat read of pre-blob top-level trigger keys with blob-snapshot fallback; legacy read path.',
            },
            {
              file: 'src/background/allowedUrlsSync.ts',
              reason:
                'Derived allowlist cache synced from the settings blob on every settings write plus startup seed (fail-closed reader); write-through cache, not a settings source.',
            },
            {
              file: 'src/background/dailyPurgeHandler.ts',
              reason:
                'Export bookkeeping sweep: enumerates the whole store and removes expired export keys; maintenance, not settings.',
            },
            {
              file: 'src/background/dashboardSqliteWiring.ts',
              reason:
                'One-shot cleanup remove of legacy keys during dashboard/SQLite wiring.',
            },
            {
              file: 'src/background/localMarkdownExportCore.ts',
              reason:
                'Export file payload store (get-all plus remove of flushed keys); content data, not settings.',
            },
            {
              file: 'src/background/localMarkdownExportRetention.ts',
              reason:
                'Export retention bookkeeping read (download IDs / erase queue); content data, not settings.',
            },
            {
              file: 'src/background/webhookExport/webhookExportSettings.ts',
              reason:
                'Migration candidate: pre-existing per-feature settings store behind an injectable seam; move to SettingsRepository in a follow-up PBI.',
            },
            {
              file: 'src/background/webhookExport/webhookExportHistory.ts',
              reason:
                'Feature event log behind an injectable WebhookExportStore seam; history data, not settings.',
            },
            {
              file: 'src/offscreen/opfsWorker/migrationV2.ts',
              reason:
                'One-shot OPFS migration marker keys; migration infra, not settings.',
            },
            {
              file: 'src/offscreen/sqliteEngineContext/fallbackMigration.ts',
              reason:
                'Fallback-mode flag cleanup during engine migration; migration infra, not settings.',
            },
            {
              file: 'src/offscreen/sqliteEngineContext/migrationBackup.ts',
              reason:
                'Pre-migration backup payload store; storage-engine safety copy, not settings.',
            },
            {
              file: 'src/offscreen/sqliteEngineHost.ts',
              reason:
                'OPFS fallback-mode flag owned by the storage engine itself; engine-internal state.',
            },
            {
              file: 'src/offscreen/sqliteStatus.ts',
              reason:
                'Engine status probe read; diagnostics, not settings.',
            },
            {
              file: 'src/offscreen/storageFallback.ts',
              reason:
                'OPFS-unavailable fallback key-value/audit store plus quota reads; implements a storage engine, not a settings client.',
            },
            {
              file: 'src/dashboard/panels/asyncData/sqliteHistoryModel.ts',
              reason:
                'Migration candidate: sort preference behind an injectable SortPreferencePersistence seam; UI-only preference.',
            },
            {
              file: 'src/dashboard/panels/diagnostic/debugModeStore.ts',
              reason:
                'Migration candidate: debugMode flag port centralizing the key; diagnostic flag.',
            },
            {
              file: 'src/dashboard/panels/diagnostic/DiagnosticsCollector.ts',
              reason:
                'Quota diagnostic read (getBytesInUse, injectable via deps); diagnostics, not settings.',
            },
            {
              file: 'src/popup/contentFetchGateway.ts',
              reason:
                'Reader-only opt-in flag read on the migration-allowlisted top-level key; the one-click flow must stay writer-free.',
            },
            {
              file: 'src/utils/aiSummaryCleaner/feedbackQueue.ts',
              reason:
                'Cleansing feedback queue under withOptimisticLock; telemetry queue, not settings.',
            },
            {
              file: 'src/utils/aiUsageTracker.ts',
              reason:
                'Usage metering counters plus migration-compat blob/top-level settings reads; metering, not a settings writer.',
            },
            {
              file: 'src/utils/crypto/hmacKeyStore.ts',
              reason:
                'HMAC key envelopes plus quarantine writes must bypass settings encryption (storing keys inside the encrypted blob is circular).',
            },
            {
              file: 'src/utils/crypto/kdfNegotiator.ts',
              reason:
                'Legacy KDF salt/secret bootstrap read for key derivation; crypto setup precedes settings decryption.',
            },
            {
              file: 'src/utils/logger/storageAdapter.ts',
              reason:
                'Log ring-buffer store behind an injectable, serialized LogStorageAdapter; the logger must stay independent of the settings seam to avoid import cycles.',
            },
            {
              file: 'src/utils/pendingStorage.ts',
              reason:
                'Pending-pages queue plus one-shot legacy-key migration; queue infra, not settings.',
            },
            {
              file: 'src/utils/trustDb/TrustDbKernel.ts',
              reason:
                'Trust database blob load; security dataset, not user settings.',
            },
          ],
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
          ],
        },
      ],
    },
  },
  {
    // System Architect review 2026-10-15 (Phase 5): background → content の
    // 静的 import を機械的に禁止。実例は e2eProbeHandlers → content/e2eTestState:
    // service worker が content 前提のモジュールを import すると、それが
    // SW では未定義になる処理（DOM / window）ごとバンドルに混入し得る。
    // 共有ロジックは src/utils/ の中立層に配置すること。
    // Form matches the messaging layer-ban block below (the TS variant, so the
    // message text and the pattern style stay identical); type imports are
    // banned too ― the point of the gate is that no background → content edge
    // exists at all, and the core rule in the block above could not be
    // scoped to content without sharing its warn severity with the UI ban.
    files: ['src/background/**/*.ts'],
    ignores: ['src/**/__tests__/**'],
    languageOptions: { parser: tsParser },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/content/*', '**/content/**', '**/content.js'],
          message: 'background 層から content 層への import は禁止。共有ロジックは src/utils/ の中立層に配置すること。See dev-docs/LAYERS.md.',
        }],
      }],
    },
  },
  {
    // PBI 2026-09-22-02 follow-up: wasm/offscreen → dashboard の上向き依存を禁止。
    // pin テスト src/__tests__/tagcooccur-layer-direction.test.ts は from 行の
    // import しか gate で失敗させないため、side-effect import（from 節なし）と
    // barrel 形（from '../../dashboard'）は pin テストでは検出できない。この
    // ルールは 3 形式をまとめて lint ゲートで失敗させる。level を error にして
    // いるのはこのため（background ブロックの warn と意図的に異なる）。ツリーは
    // クリーンで 0 違反のため error 化の影響はない。共有語彙は src/utils/ に配置。
    // `allowTypeImports` を付けていないため `import type ... from` も同じく
    // error になる（型だけの辺でも層の向きは同じく反転する）。
    // group は 3 パターン: `**/dashboard/**` は dashboard 配下のファイルに、
    // `**/dashboard.js` は dashboard.js 単体に一致する。bare barrel 形
    // （`import '../../dashboard';`）は gitignore セマンティクス上
    // `**/dashboard/**` では末尾セグメントがなく一致しないため、
    // `**/dashboard` を追加して barrel も一致させる。dashboards 等の
    // 別セグメント名には誤検出しないことを matcher で確認済み。
    files: ['src/wasm/**/*.ts', 'src/offscreen/**/*.ts'],
    ignores: ['src/**/__tests__/**'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: process.cwd(),
      },
    },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/dashboard/**', '**/dashboard.js', '**/dashboard'],
          message: 'wasm/offscreen 層から dashboard への上向き import は禁止。共有語彙は src/utils/ に配置すること。See dev-docs/LAYERS.md.',
        }],
      }],
    },
  },
  {
    files: ['src/messaging/**/*.ts'],
    ignores: ['src/**/__tests__/**'],
    languageOptions: { parser: tsParser },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      // Core rule cannot exempt `import type`; the TS variant can.
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/background/**'],
          allowTypeImports: true,
          message: 'messaging is the neutral wire layer: no runtime import from background (import type is allowed). See dev-docs/LAYERS.md.',
        }],
      }],
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
    // PBI 2026-10-05-03: vitest hygiene rules also cover the vitest suites
    // outside src/** so fixed sleeps cannot accumulate unwatched there.
    files: ['src/**/__tests__/**/*.test.ts', 'testDir/__tests__/**/*.test.ts', 'eslint/__tests__/**/*.test.ts'],
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
      // PBI 2026-09-28-29: protocolVersion is stamped by MessageTransport.send()
      // only. Hand-stamped envelopes bypass validation and retry.
      'local/no-manual-protocol-version': 'error',
      // Migration warning, not an error: vi.useFakeTimers() with the default
      // toFake replaces setImmediate/queueMicrotask and hangs any dynamic
      // import awaited under it. 124 pre-existing call sites still use it, so
      // promoting this to 'error' would break the build for untouched code.
      'local/no-greedy-fake-timers': 'warn',
      // PBI 2026-10-12-04: a declaration-form skip (it.skip('name', fn)) never
      // runs and keeps the suite green while its coverage disappears. Runtime-
      // conditional forms (test.skip(cond, reason), skipIf, single-string
      // Playwright test.skip('reason')) stay valid ― see
      // eslint/rules/no-dead-test-skip.mjs for the discriminator.
      'local/no-dead-test-skip': 'error',
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
    // half-configured type-aware project ― that would break src/**'s
    // `project: './tsconfig.json'` resolution in the same flat config.
    files: ['testDir/**/*.{ts,js,mjs}', 'bench/**/*.{ts,js,mjs}'],
    plugins: {
      local: localPlugin,
    },
    rules: {
      'local/no-fixed-wait': 'error',
      // PBI 2026-10-05-03: no-fixed-wait covers member calls only
      // (page.waitForTimeout). Bare setTimeout sleeps in E2E/bench are
      // no-test-sleep's business ― same rule as src/**/__tests__.
      'local/no-test-sleep': 'error',
      // PBI 2026-10-12-04: the Playwright counterpart of the vitest block's
      // no-dead-test-skip. The E2E conditional skips
      // (test.skip(cond, reason) / test.fixme(true, HEADLESS_FIXME_MESSAGE))
      // are runtime-conditional and stay valid.
      'local/no-dead-test-skip': 'error',
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
