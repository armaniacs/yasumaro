# PBI Index

`pbi/` 配下のPBI実装状況一覧。新規PBI作成時・実装完了時はこの表を更新すること。

**`pbi/` には未完了のPBIだけを置く。** 完了したものは `dev-docs/archived/pbi/` へ移動し、
このINDEXの表からは削除して「アーカイブ履歴」に1行残す。

凡例: ⬜ 未着手 / 🔶 部分実装（一部基準のみ満たす）
難易度: 🟢低（1pt目安） / 🟡中（2pt目安） / 🔴高（3pt以上目安） — 各PBI内「見積もり」セクションのポイントに基づく
副作用: 🔴あり（既存機能・既存ユーザーに実害の可能性） / 🟡軽微（コスト増や要検証点はあるが致命的でない） / 🟢なし（安全に対処可能）
種別: ✨機能追加（feat、ユーザーに見える新機能） / 🔧非機能追加（fix/refactor、バグ修正・内部改善・性能改善など機能追加を伴わないもの）

---

## 進行中 ⬜ 未着手 / 🔶 部分実装

**進行中の PBI は 0 件。** `pbi/` には INDEX と backlog のみが残る。

### 2026-09-04 パフォーマンス最適化 8 件（ベンチ基盤先行） — 8 件完了

backlog: [2026-09-04-00-backlog-perf.md](2026-09-04-00-backlog-perf.md)。着手順 = ファイル番号（NN）。**01 が残り 7 件の依存元**（実測ベンチ基盤）。
全 8 件完了（2026-09-04、branch 0904b）。`bench:check` PASS（gated カウンタ全改善: c5 schedule_calls -99% / c6 query_calls -93% / c1 encode -75% / c2.L p99 -49% / c3 M p95 -55%）。08 のみ方式 B 実装後にベンチで逆効果（+53〜178%）が判明し revert・計測ベースでクローズ。02 の単発タイマー化に伴う untrusted scroll 報告経路は deferred 評価（1 秒）で復活済み。アーカイブ: `dev-docs/archived/pbi/2026-09-04-0[1-8]-*.md`、HTML レポート設計は `2026-09-04-09-spec-bench-html-report.md`（実装済み・同梱）。

### 2026-09-04 0902a レビュー由来（重複・dead-code 7件→3PBI） — 3件完了

- 2026-09-04-01-fix-api-key-list-ssot.md（RICE 60 — `apiKeyFields.ts` SSOT新設。storagePort/settingsMigrationの二重定義を解消、drift検出テスト追加。type-check / lint / 関連46 tests / build green）
- 2026-09-04-02-fix-domain-filter-duplication.md（RICE 2.4 — `evaluateCachedAllow`共有ヘルパー抽出、`parseAndValidate`に`isValidDomainPattern`統合（新`domainValidator.ts`で循環回避）、dashboard保存時検証を単一seamに。113 tests green）
- 2026-09-04-03-cleanup-review-dead-exports.md（chore — RequiresPrivacy/Markdown、Slice系4型、domainFilter singleton、RedactingStoragePortを削除。redact関数は維持、DESIGN_SPECIFICATIONS同期。64 tests green）


### 未 PBI 化のトリガー
- **なし。** PBI 06 の効果確認は 2026-09-01 に実施済み（未達 → 06b/06c を実装し達成）。残債は `2026-08-31-00-backlog.md` の「06d 候補」に記録（次 provider 追加時などに着手検討）

### archived PBI の DoD 乖離監査（2026-09-01）
`autonomous-task-closer` で archived PBI のチェックボックスと実コードを照合。実害ありは PBI-22（対応済み）のみ。表記のみの乖離を各 archived PBI の実装メモに追記済み。特記:
- `2026-08-29-12-fix-crypto-policy-ssot` — 中核実装済み、2 項目未達 → `2026-09-01-05` に切り出し実装・アーカイブ済み
- `2026-08-24-03-refactor-sqlite-consolidation` — 部分実装（`storageMaintenance.ts` の動的 import 未解消、実害低）。追加 PBI 化は見送り
- `2026-08-30-05-feat-cleansing-offscreen-delegation` — PoC 品質（flag OFF で本番未使用）。追加 PBI 化は見送り

---

## 運用ルール

- 新規PBIは `pbi/YYYY-MM-DD-NN-type-slug.md` として作成する
  （`type` は `feat` / `fix` / `refactor` / `doc` / `test` / `investigate`。
  ファイル名の種別がそのまま機能追加/非機能追加の判定基準になる）
- 実装計画は `dev-docs/plans/YYYY-MM-DD-pbiNN-<slug>-plan.md` として作成する
- **`plans/` ディレクトリは廃止。** 今後はすべて `dev-docs/plans/` に一本化する
- **完了したPBIは `dev-docs/archived/pbi/` へ、対応する実装計画は
  `dev-docs/archived/plans/` へ `git mv` で移動する**
- 対応する dig-findings ファイル（`dev-docs/dig-findings-*.md`）は
  `dev-docs/archived/` へ `git mv` で移動する
- 移動したらこのINDEXの表から行を削除し、下の「アーカイブ履歴」に1行追記する

---

## アーカイブ履歴

完了済みPBIは [dev-docs/archived/pbi/](../dev-docs/archived/pbi/)、
その実装計画は [dev-docs/archived/plans/](../dev-docs/archived/plans/) にある。

### 2026-09-03 0902a ブランチレビュー由来の CRITICAL 修正 — 5件完了

- 2026-09-03-01-fix-ssrf-allowlist-bypass.md（RICE 4.8 — `isAllowedProviderBaseUrl` を CIDR 範囲で堅牢化。0.0.0.0/8, 127.0.0.0/8, 169.254.0.0/16 の範囲ブロック追加、整数/hex IPv4 デコード、IPv6 ブロック (::1/::ffff:/fc00/fe80)。BDD テスト 38 件。type-check / lint / build green）
- 2026-09-03-02-fix-trust-policy-orphan-singleton.md（RICE 4.8 — TrustPolicy の orphan fallback を撤廃し `getTrustDbAdmin().getPolicy()` に委譲。TrustDecision は `this.admin.getPolicy()` を毎回 lookup し stale cache を排除。BDD テスト 13 件。type-check / lint / build green）
- 2026-09-03-03-fix-dashboard-confirm-token-fail-closed.md（RICE 10.8 — dashboardGateway の confirm-token を fail-closed 化。token 取得失敗時に IPC を送らず `SqliteResult` エラーで返す。BDD テスト 16 件。type-check / lint / build green）
- 2026-09-03-04-fix-domain-filter-mode-inversion.md（RICE 5.4 — DomainFilter の `isAllowedCached` / `CacheAdapter` が mode を無視し blacklist を whitelist として反転していたバグを修正。`isDomainInList` ヘルパ抽出、mode thread、cache に mode 追加。BDD テスト 44 件。type-check / lint / build green）
- 2026-09-03-05-cleanup-orphan-exports-dead-mocks-shim-importers.md（RICE 0.9 — orphan exports 削除 (withLockViaPort, PROVIDER_REGISTRY, isDomainTrusted convenience)、dead vi.mock 除去 2 件、7 prod importer を optimisticLock → storageTransaction に移行、`optimisticLock.ts` 物理削除。type-check / lint / build green）


### 2026-09-04 dashboard テスト confirm-token ハンドシェイク対応 — 1件完了

- 2026-09-04-01-test-dashboard-confirm-handshake.md（RICE 8.0 — PBI 03-v1 の fail-closed 化で破壊的操作が2段階送信になったことに dashboard 系テスト 56件が未対応だった問題を解消。shared ヘルパ `__tests__/helpers/dashboardSqliteMock.ts`（subtype ルーティング）を新設し 4 ファイルを移行。付随して lockContract.test.ts の削除済み optimisticLock import も修正（commit d567547c）。119 tests green）

### 2026-09-03 Architecture Deepening Round 2026-09-03b — 7件完了（Trust / Retry / Pipeline / Composition / Provider / SQLite）

- 2026-09-03-01-refactor-trust-seam-consolidation.md（RICE 12.0 — globalThis registry 廃止。TrustDbKernel の `__trustDbKernel` 登録と TrustPolicy の `__TrustPolicyClass` を削除。`getTrustPolicy()` を `getTrustDbAdmin().getPolicy()` 委譲に、TrustDecision は `admin.getPolicy()` 毎回 lookup で stale 排除。Admin/Kernel に `isInitialized()` 追加で fail-closed 維持。158 tests green）
- 2026-09-03-02-fix-retry-policy-ai-false-positive.md（RICE 9.6 — `isNetworkError` から `lower.includes('ai ')` を削除。ADR 2026-08-27 列挙語（network/fetch/timeout/offline/econnrefused/enotfound）+ connection/unavailable のみに限定。境界テスト 5 件追加。type-check / lint / build green）
- 2026-09-03-03-refactor-pipeline-consolidation.md（RICE 6.0 — PipelineKernel(60行 thin loop)を RecordingOrchestrator.executeInternal に inline 化し削除。sole state owner 化でセマンティクス集約。89 tests green）
- 2026-09-03-04-refactor-staged-context-branding.md（RICE 4.8 — StagedContext<S>/ContextStage 等 dead branding を削除。createInitialContext/assertStage 撤去、RetryContext を RecordingContext に。type-check / lint / build green）
- 2026-09-03-05-refactor-composition-root-typed.md（RICE 4.0 — setSqliteHealthCheck/getSqliteHealthCheck の module-global ペアを削除。ensureStorageQuota の fallback chain を単純化、manifest onReady wiring 撤去。storageMaintenance テスト追加。type-check / lint / build green）
- 2026-09-03-06-refactor-provider-catalog-split.md（RICE 2.7 — isAllowedProviderBaseUrl(124行)を providerSecurityPolicy.ts に分離。catalog は re-export で後方互換。61 tests green）
- 2026-09-03-07-refactor-sqlite-gateway-single-seam.md（RICE 2.0 — sendDashboard の重複 Promise.race を sendDashboardRaw に統一。dashboardGateway テスト 16件 green）

### 2026-09-03 Architecture Deepening 0903 — 7件完了

- 2026-09-03-01-refactor-storage-concurrency-primitive.md（RICE 720 — `StorageTransaction` deep module（`withLock`/`withAtomic` 2メソッド）に統合。`optimisticLock`/`keySerializer` を shim 化、`SettingsRepository` の `isChromePort` 分岐を撤去、`InMemoryStoragePort` の explicit `_version` 対応と contract test 18件追加。type-check/lint/test/build green）
- 2026-09-03-02-refactor-provider-catalog-unification.md（RICE 213 — `ProviderCatalog` を deep module 化。`providerRegistry` を shim 化、`RemoteAIService` の switch を委譲に、`aiProviderCatalogView` の `KEY_TO_INPUT_ID` を `storageKeyToInputId` 関数に。type-check/lint/test/build green）
- 2026-09-03-03-refactor-recording-orchestrator-modes.md（RICE 186 — `retryPolicy` 抽出と `retrySteps` コンパイル完了、typed Context は `contextBuilder.ts`（211行）に抽出、`StepDeps` の `?? sqliteClient` fallback 削除、`pickDefined` spread を builder に置換。288 tests green）
- 2026-09-03-04-refactor-trustdb-seam-split.md（RICE 168 — `TrustDbAdmin`（mutation）と `TrustPolicy`（readonly）の 2 seam に分割。`trustDb.ts` shim を物理削除（04b commit: 64609768）。`STORAGE_KEY` を `StorageKeys.TRUST_DB` に集約、`settingsReader` を `SettingsRepository` 経由に、全 prod caller を `getTrustDbAdmin`/`getTrustPolicy` に移行（16 files）。227 tests green）
- 2026-09-03-05-refactor-recording-cache-split.md（RICE 80 — `SettingsCache`/`UrlCache`/`PrivacyCache` 3モジュールに TTL 分離。`RedactingStoragePort` で `redactSettingsApiKeys` を委譲。`RecordingCacheInstance` を 3 cache compose の true facade に。42 tests green）
- 2026-09-03-06-refactor-domain-filter-unification.md（RICE 58 — `DomainFilter` を single seam に統合。`wildcardToRegex` 一本化、`domainFilterCache` の blacklist 空配列 TODO 解消、`CacheAdapter` 第2 adapter で seam を実在化、TTL は construction param に。37+ tests green）
- 2026-09-03-07-refactor-sqlite-gateway-fidelity.md（RICE 12 — `OffscreenGateway`（131行）と `DashboardGateway`（67行）に hop 分割。`InMemoryTransport` の `ORDER BY` を `localeCompare` に修正、`sanitizeFtsTerm`/`QUERY_CAPS`/`matchesExtraWhere` を共有化。`sqliteClient.ts` shim を物理削除（07b commit: 8f1d956d）。14 contract tests green）

- 2026-09-03-08-fix-daily-note-path-placeholder-discoverability.md（RICE - — `dailyNotePathPlaceholder` を `092.Daily または raw/YYYY-MM` に、`dailyNotePathHelp` を ja/en 追加、`entrypoints/options/index.html` に help-text 追加、`docs/FAQ`/`SETUP_GUIDE` に月次例追記、`dailyNotePathBuilder` に 3ケース追加。build 後の dist で placeholder と help-text を目視確認、validate green）

詳細な 5 Whys は `/tmp/kilo/whywhy-remaining.md` に記録。

### 2026-09-02 i18n チェック誤検知修正 — 1件完了

- 2026-09-02-01-fix-i18n-check-false-positive.md（RICE 300 — check-i18n.mjs:84 の配列への `in` 演算子バグ修正。`Object.keys()` の戻り値（配列）に `in` を使っていたため全 1,247 キーが「extra」と誤判定。オブジェクト照合に修正し、extra キー検出を warn→fail に昇格。比較ロジックを i18n-core.mjs に抽出し 16 テストを追加。Models.dev プロバイダー例の Perplexity→Hugging Face 修正も含む。release:check 7/7 PASS（i18n 警告 0 件）、validate PASS）

### 2026-08-31 Architecture Deepening 0831a — 6件全完了（PBI 01〜06）

- 2026-08-31-01-fix-settings-dual-truth.md（RICE 2160 — `SettingsRepository` への一本化。`settingsStore.legacy.ts` / `settingsStore.ts` を削除し、`storage.ts` barrel を SettingsRepository 委譲に切り替え。旧 re-export を settingsMigration / urlWhitelist / storageMaintenance / savedUrlRepository へ振り直し。34 call sites + 約 90 テストファイルの import を移行。`getAll()` の scattered fallback を `__getAllScatteredFallback` test 専用 seam に分離。ADR `2026-03-20-default-settings-single-source.md` に Phase 4 追記。type-check / lint / test / build green）
- 2026-08-31-03-fix-trustdb-god-module.md（RICE — trustDb god module を `TrustDbKernel`（lifecycle + 単一 `chrome.storage` 読取 + 単一 `withOptimisticLock`）/ `TrustPolicy`（`isDomainTrusted` / `isTrancoDomain` seam）/ `ManagedCollections`（userTlds / sensitive / whitelist 束ね）に分割。`trustDb.ts` は re-export shim に。settings アクセスを注入可能な `settingsReader` port 化し、ADR 2026-08-20 の循環 1 を解消。dead code の `whitelistStore.ts` / `sensitiveDomainStore.ts` を削除。DESIGN_SPEC §5.5 新設 + ADR 2026-08-20 に解消記録。11109 tests green。残: 破損 DB 復旧の手動 e2e 確認のみ）
- 2026-08-31-06-feat-provider-catalog.md（RICE — Speculative。`ProviderCatalog` を単一 seam として先行実装。csp / cspSettings / DiagnosticsCollector / getMaxContentChars を Catalog 駆動化。DESIGN_SPEC §11.3 新設。再評価トリガー（次 provider 追加時）を backlog に明記。11109 tests green。**2026-09-01 効果確認 → 未達（約 20 ファイル分散）→ 06b/06c を実装して達成**、下記フォローアップ参照）
- 2026-08-31-05-feat-sqlite-gateway-unification.md（RICE — 2 つの RPC スタックを `SqliteGateway`（query/mutate/maintain/status + 統一 `SqliteResult<T>`）に統合。`SqliteClient` / `dashboardSqliteService` を委譲 shim に。`queryPlan.ts` に WHERE 生成を集約し `IdbVfsBackend` / `searchHandlers` の重複を削除。`StorageBackend` を `Queryable` / `Mutable` に分割。dashboard hop の二重 `categorizeError` を修正。`OffscreenTransport` の 2nd adapter として `InMemoryTransport`（stateful in-memory store、chrome.* 不要）を実装。DESIGN_SPEC §5.4 追記。11117 tests green。フォローアップ: 未接続の `BrowsingLogRepository.ts`（PR #87 由来）の整理）
- 2026-08-31-02-feat-recording-orchestrator.md（RICE 480 — `RecordingOrchestrator` の単一 `record(data, opts)` seam に集約。`PerUrlMutexMap` の static 共有マップを削除し、container singleton の `perUrlMutexMap` を pipeline deps に配線して cross-instance の URL 直列化を回復（**duplicate-entry race の修正**）。`buildRecordingPipelineDeps` identity 関数を削除。`RecordingPipeline` facade から `recordWithPreview` を削除。DESIGN_SPEC §8.3 新設。11117 tests green。フォローアップ: `RecordingPipeline` facade / `createRecordingPipeline` の完全撤去（blast radius 大、別 PBI））
- 2026-08-31-04-feat-composition-manifest.md（RICE 210 — Service Worker composition root を宣言的 `compositionManifest.ts`（`CompositionEntry[]` = `{ key, factory(container), singleton, onReady? }`）に。`createBackgroundServices` は manifest の register ループに縮小（import 36→16）。`dashboardSqliteClient` / `dashboardSqliteHandler` alias を composition から除去（後者は router 経由）。`setPendingWriteQueue` / `setSqliteHealthCheck` の副作用を `onReady` に局所化。`deps` フィールドは持たず factory が `resolve` する設計（型推論パズルを回避）。DESIGN_SPEC §2.2 新設 + ADR 2026-08-20 に循環 2 の配線整理を追記。11117 tests green）

### 2026-09-01 0831a フォローアップ / DoD 乖離監査 — 6件完了

- 2026-09-01-05-fix-crypto-policy-ssot-followup.md（archived PBI 2026-08-29-12 の DoD 未達 2 項目。**VULN-035**: `exportLogsService.exportJson()` に HMAC 署名（`version: 2`）、`importLogsService.importFromJson()` に署名検証ゲート。無署名（旧 v1）/ 改竄ファイルは拒否（旧ログ JSON は再インポート不可）。**VULN-039**: `hmacKeyStore` の署名鍵・ラップキー生成を 2 ロック（outer→inner）で直列化、`confirmTokenManager` のトークンマップ RMW を `withTokenMap()` で直列化。各 concurrency テスト付き（fix なしで fail 確認済み）。CHANGELOG / PRIVACY 更新。PR #103/#104。11116 tests green + e2e 28 passed）
- 2026-08-27-22-feat-unify-messaging-transport.md（archived PBI の受け入れ基準「`ChromeMessageSender` が削除されている」が未達だったため PR #102 で対応。`src/utils/retryHelper.ts` を全削除、`src/content/contentMessageSender.ts`（`MessageTransport` アダプタ）を新設、`visitReporter` / `contentKernel` / `extractor` / `previewFlow` を移行。実装メモに 2 段階完了を追記。11107 tests green）
- 2026-09-01-04-refactor-provider-ui-catalog-driven.md（PBI 06 効果確認の対応 06c — ダッシュボード provider UI 層を `ProviderCatalog` 駆動に。`registry` に UI メタデータ（labelI18nKey / fieldPlaceholders / supportsCustomPrompt / settingsBlockKind）を追加。新規 `aiProviderCatalogView.ts`（`renderProviderOptions` / `renderProviderSettings`）で A/B 両レイアウトと custom-prompt select を catalog 駆動に。`index.html` の `<option>` グループ ×4 と 7 個の `<div id="*Settings">` を削除し `#providerSettingsMount` に集約。`aiProviderLabels.ts` 依存を撤去、`settings/aiProvider.ts` の `AIProviderElements` を `{ select; settings: Record<...> }` に一般化。`CustomPrompt.provider` 型を lm-studio/ollama に拡張（ランタイムは既に対応、型/UI のみの不足 = バグ修正）。conformance test 拡張。PR #97/#98/#99。11136 tests green + e2e 185 passed）
- 2026-09-01-03-refactor-provider-catalog-consolidation.md（PBI 06 効果確認の対応 06b — `ProviderCatalog` のデータソースを `PROVIDER_REGISTRY` 1 箇所に統合。`CSP_DOMAINS` / `LABELS` / `CONTENT_CHARS_KEYS` の 3 独立表と `src/utils/aiProviderLabels.ts`（provider label の 2 コピー目）を削除。`urlWhitelist.ts` の 3× コピペを catalog loop 化。`DiagnosticsCollector` / `diagnosticsPanel` の provider 列挙を catalog 由来に。新規 `providerCatalog.test.ts` で half-wired provider を検出。挙動変更なし。PR #96。11117 tests green）
- 2026-09-01-02-refactor-browsinglog-repository-decision.md（RICE — 未接続の `src/dashboard/BrowsingLogRepository.ts`（PR #87 由来、296 行、consumer / test ゼロ、PBI 05 の Gateway リファクタに未追従）を削除。`dashboardSqliteService.ts`（Gateway 委譲済み）を唯一の dashboard SQLite 経路に確定。`ServiceResult` / `isServiceError` の重複を解消。アーカイブ済み PBI 2026-08-27-18 の未達だった「去就決定」チェックを追認。11117 tests green）
- 2026-09-01-01-refactor-recording-pipeline-facade-removal.md（RICE — PBI 2026-08-31-02 の残余。`RecordingPipeline` facade クラス + `createRecordingPipeline` + `buildRecordingPipelineDeps` を削除。`RecordingOrchestrator.record(data, opts)` を唯一の recording 経路に。`RecordOptions.settings` を追加し `recordingHandlers` の `execute(data, settings)` → `record(data, { settings })` に移行。`RecordingRunner`（`record` 一つ）の narrow interface で deps 注入。~12 テストファイルを orchestrator seam に移行（`.execute` → `.record`、`makeRecordingLogic` を orchestrator 生成に）。DESIGN_SPEC §8.3 を orchestrator 前提に書き換え。11117 tests green）

### 2026-08-30 VulnHunter 2026-08-29 監査対応 — 13件完了（PR #67–#81）

サブエージェント並列 + TDD で実装。各 PR は `main` にマージ済み、全 CI green。

- 2026-08-29-01-fix-regex-safety.md（PR #68 — `ublockParser/constants.ts` の `DOMAIN_VALIDATION` を線形 label-wise 検証に置換し 30ドット 8秒超の ReDoS を封鎖。`urlSkipper.matchesPattern` を `wildcardToRegex`（5個上限）に統一。`domainFilter` 保存時に両モードのリストを検証。VULN-025/026）
- 2026-08-29-02-fix-markdown-sanitizer-boundary.md（PR #81 — `sanitizeForObsidian` に HTML エンティティ化（`&`→`&amp;` 先行、`<`/`>`）を追加。既存 `sanitizeForMarkdownLinkText` の適用漏れ 4 箇所（legacy formatter / obsidianSyncService / gistSyncTarget のタイトル、タグ連結2経路）を解消。VULN-001/008/047）
- 2026-08-29-03-fix-response-body-caps.md（PR #81 — `readBodyCapped` / `readJsonCapped` を新設（ストリーミング読み取り + バイトカウンタ、`ResponseBodyTooLargeError`）。8 シンク（obsidianConfigValidator / obsidianClient 10MB+1MB / FETCH_URL / trancoUpdater 50MB / Gemini×2 / OpenAI×2 / gistSyncTarget）を置換。Gist 素 fetch 3 箇所を `fetchWithTimeout` 経由に。VULN-013/015/027/054/055）
- 2026-08-29-05-fix-query-limit-clamp.md（PR #69 — `queryPlan.ts` に `clampLimit(raw, cap, fallback)` を新設（非有限/非正→fallback、`Math.max(1, Math.min(cap, floor(raw)))`）。5 シンク（queryPlan / readOnlyHandler×3 / auditHandlers / IdbVfsBackend / recordsRepo）に配線。fts:100000 / plain:1000 の 2 cap 温存。VULN-017/021/048/049）
- 2026-08-29-07-fix-lock-cas-correctness.md（PR #81 — `trancoUpdater.ts` の更新ループを try/finally 化し恒久ロックアウト解消。`trustDb.ts` の CAS を `(current) => mergeTrustDatabase(current, localSnapshot)` に（新規 `mergeTrustDatabase.ts` — ユーザー編集リストは和集合、tranco/bloom は新しい側、非破壊）。ロック API 契約テスト追加。VULN-028/029）
- 2026-08-29-09-fix-fetch-redirect-ssrf.md（PR #70 — FETCH_URL の fetch に `redirect: 'error'` + `response.redirected` チェック。`fetchWithRedirectGuard`（`redirect: 'manual'` でホップ毎 `validateUrlForFilterImport` 再適用、最大5ホップ）を新設。ADR `2026-08-29-fetch-redirect-policy.md`。VULN-016）
- 2026-08-29-10-fix-log-integrity.md（PR #81 — `logger/neutralize.ts` を新設（`\n`→可視区切り `" ⏎ "`、ANSI CSI 除去、C0 制御文字除去。PII マスク後に適用）。LOG_FORWARD の `_source` を `deriveLogSource(sender)` で sender 由来に固定、payload `source` は `_sourceHintUntrusted` に。VULN-019/044）
- 2026-08-29-11-fix-storagefallback-mutate.md（PR #73 — `storageFallback.ts` に `private async mutate<T>(fn)` を新設（mutex → load → fn → save、try/finally）。update/hardDelete/toggleStar/clearAll/purgeOldRecords/purgeContent の 6 ミューテータを経由化。insert/insertBatch は同一 mutex の bespoke 維持（ID 確保が I/O 副作用のため）。VULN-022）
- 2026-08-29-15-fix-pending-whitelist-orphan-key.md（PR #71 — `pendingPages.ts` の `addDomainsOrPathsToWhitelist` が camelCase `'domainWhitelist'` に読み書きしていた orphan key バグを `StorageKeys.DOMAIN_WHITELIST`（`'domain_whitelist'`）経由に統一。既存値を保持して追記。機能不全の解消。C14 から分離）
- 2026-08-29-16-fix-cas-verify-write-serialization.md（PR #79 — 29-04 の残 4 サイト。`keySerializer.ts` を新設（`runSerialized` — microtask promise チェーンで key 粒度直列化、timer 非依存で fake-timer 互換、idle 時同期実行 fast path）。`optimisticLock.ts` の verify→write を bracket。MarkdownBufferManager.flush / pendingStorage add・remove / logger storageAdapter.append に適用。VULN-003/005/012/050）
- 2026-08-29-17-fix-local-export-retention.md（PR #78 — 29-08 の VULN-004。`localMarkdownExportRetention.ts` を新設（download ID 記録 上限200、`purgeExpiredDownloadRecords` で `chrome.downloads.erase`、retention 30日）。`flushBufferedExports` がフラッシュ後にキー削除。`MarkdownBufferManager` の日次バッファを `MAX_DAILY_BUFFER_ENTRIES`=2000 で上限化）
- 2026-08-29-18-fix-secondary-compute-input-caps.md（PR #77 — 29-08 の VULN-041/051/053。`computeLimits.ts` を新設（`MAX_TAGS_PER_RECORD`=50 / `MAX_SENTENCES_FOR_TEXTRANK`=200 / `MAX_TAG_CLUSTER_TAGS`=50）。tagCooccurrence の二重ループ前・TextRank 前・tagClusterPanel の共起計算前に cap。browsingLogCodec に書き込み側 tag cap。5000文 TextRank 21,572ms→~20ms）
- 2026-08-30-15-feat-llm-output-quality-guard.md（PR #72 — `llmOutputGuard.ts` を新設（`isDegenerateOutput` — repetition / lowDiversity / highlyCompressible のいずれかで縮退判定、notSentence は補助のみ、名前付き閾値定数）。`privacyPipeline._processCloudResult` の `parseTagsFromSummary` 後に単一チェックポイントとして組込み、縮退時はフォールバック文字列 + `addLog(WARN)`。`historyEntryRow.ts` で表示時マスク）

**部分着地で `pbi/` に残置**: 29-04（2/6サイト・PR #74）、29-08（3/7指摘・PR #75）、29-13（AC1/4/5/6・PR #76）、29-14（AC2–6・PR #81）。付随して lint 修正（PR #80）、PBI 索引整備（PR #67）もマージ。

### 2026-08-30 plan/0830-backlog-execution — 17件完了（Wave0-3）

- 2026-08-29-04-fix-storage-rmw-serialization.md（Wave0 verify green をもってアーカイブ — 変異テスト green で再スキャン代替）
- 2026-08-29-06-fix-trust-boundary-consistency.md（06a loader+offline `ad019810` + 06b token+permission `d85fbf3f` — e2e cold cache SW await、offline force:false、confirm_token パーアクション化、権限ラダー）
- 2026-08-29-08-fix-resource-boundary-caps.md（Wave0 verify green）
- 2026-08-29-12-fix-crypto-policy-ssot.md（`4958c243` — cryptoParams SSOT 600k、KEK session-only、RateLimit local永続化、HMAC先行化）
- 2026-08-29-13-fix-import-pipeline-safety.md（29-12 に HMAC 統合済みとしてアーカイブ）
- 2026-08-29-14-fix-security-hardening-code-quality.md（Wave0 verify green）
- 2026-08-29-19-fix-cspvalidator-self-allow.md（Wave0 verify green）
- 2026-08-30-12-feat-cleansing-i18n-expanded-patterns.md（`282ec5e4` — 37パターン追加、テキストマッチで誤爆回避）
- 2026-08-30-04-investigate-cleansing-single-pass-benchmark.md（`da4d2075` — 100/500/1000要素で 84/388/772ms、要1パス検討）
- 2026-08-30-06-feat-cleansing-presets.md（`76ab00e5` — presets 4種、migrateToPreset、customガード）
- 2026-08-30-09-test-cleansing-corpus-ci.md（`0950661d` — 10サイト + check-cleansing-corpus）
- 2026-08-30-02-feat-cleansing-semantic-classification.md（`d1eb75b0` — x-具体化、決定木化）
- 2026-08-30-01-feat-cleansing-readability-scoring.md（`f2a58e22` Spike + `40252dd8` 閾値120 — 33%→100%）
- 2026-08-30-14-refactor-cleansing-observability-funnel.md（`b6b6d7de` — removedByReason/funnel）
- 2026-08-30-11-feat-cleansing-transparency-dual-payload.md（`b6b6d7de` — originalContent/dualPayload）
- 2026-08-30-13-feat-cleansing-spa-dynamic-content.md（`b6b6d7de` — watchDynamicContent）
- 2026-08-30-03-feat-cleansing-shadow-dom-traversal.md（`b6b6d7de` — querySelectorAllDeep）

残置: なし（全PBI完了）、バックログ索引はアーカイブ済み

### 2026-08-30 バックログ索引アーカイブ

- 2026-08-29-00-backlog-vulnhunt-audit.md（VulnHunter監査バックログ — 全16件の実体PBIがアーカイブ済みのため本文書も移動）
- 2026-08-30-00-backlog-cleansing.md（クレンジング改善バックログ — 全14件の実体PBIがアーカイブ済みのため本文書も移動）
- 2026-08-31-00-backlog-ui-visibility.md（UI/デザイン視認性バックログ — 全1件の実体PBIがアーカイブ済みのため本文書も移動）

- 2026-08-30-05-feat-cleansing-offscreen-delegation.md（`e7540e66` — Offscreen委譲 PoC、feature flag OFFでフォールバック）
- 2026-08-30-10-feat-whitelist-adapter-auto-generation.md（`7faaad20` — generate-whitelist-adapter.mjs、候補17セレクタ計測＋LLMプロンプト）

- 2026-08-30-07-feat-cleansing-per-site-override.md（`45ae459d` — DOMAIN_CLEANSING_OVERRIDES、perSiteOverride、options UI）
- 2026-08-30-08-feat-cleansing-feedback-loop.md（`5ad9e055` — feedbackQueue 50件FIFO、popup報告/Dashboard一覧）

### 2026-08-31 ライトモード視認性改善 完了

- 2026-08-31-01-fix-light-mode-visibility-dashboard.md（RICE 32.4 — B分離型 AIプロバイダー設定（`.b-priority-row` / `.b-provider-details` / `.b-provider-summary` / `.b-priority-handle` / `.ai-layout-toggle`）のハードコード暗色（`#27272a` / `#18181b` / `#3f3f46` / `#a78bfa` / `#e4e4e7`）を `--color-*` トークンに置換（CSS は PR #84 `9e240f60` で着地）。`--color-*` は `dashboard.css:95` の `@media (prefers-color-scheme: dark)` で反転するため、別 `@media` ブロック不要でライト＝紙色 `#f8fafc`/`#ffffff`、ダーク＝墨色 `#161b22`/`#0d1117` を自動で使い分ける。`.ai-layout-toggle` の未定義 `--color-surface` フォールバックで常時 `#27272a` を描画していたバグも解消。単体テスト `tests/dashboard/aiProviderBLightMode.test.ts`（CSS ソースのトークン使用と暗色直値の不在をアサート）、E2E `testDir/e2e/dashboard-light-mode.spec.ts`（ビルド後 options CSS を最小 DOM に適用し `page.emulateMedia({ colorScheme })` で light/dark の背景 computedStyle を検証、chromium + firefox で 6 ケース green）。BDD「ハードコード残存検出」: `grep "#27272a\|#18181b\|#3f3f46" entrypoints/options/dashboard.css` → 0 件、ビルド後 `dist/**/options-*.css` の該当ルールも全て `var(--color-*)`。type-check / validate（10839 tests）PASS）

### 2026-08-29 リリース前チェックのブロッカー解消 完了

- 2026-08-29-01-fix-release-check-blockers.md（RICE 4800 — i18n 未翻訳4キー（`modelsDevDialogTitle`/`tabAll`/`tabAggregator`/`tabOthers`）を en/ja に追加し check-i18n を PASS に。branches カバレッジは14ファイルへのテスト追加（88.94%）に加え、node_modules の `eslint` 欠落で失敗していた `eslint/__tests__` 2スイートを `npm install` で解消して 90.02% に回復させ、ゲート余裕確保のため permissionManager / onboardingWizard / privacySettings / manualContentFetcher / sourceManager の5ファイルにテストを追加し 90.41%（+47 branches）。欠落していたローカル生成物 `sbom.json` を `npm run generate-sbom` で再生成。`release:check:fast` 7/7 PASS / `validate` PASS / 10580 tests PASS）

### 2026-08-28 RateLimiter/SessionAlarms Service化 完了

- 2026-08-27-24-feat-service-rate-limiter-session.md（RICE 135 — `src/utils/rateLimiter.ts`（マスターパスワードのブルートフォース制限）を `RateLimitService(Clock, StoragePort)` に、`src/background/sessionAlarmsManager.ts`（自動ロック用 chrome.alarms 管理）を `SessionAlarmService(AlarmPort, Clock, StoragePort, SendMessageFn)` にクラス化。両モジュールの既存エクスポート関数はデフォルトインスタンス委譲の薄いラッパーとして維持し呼び出し元（`masterPassword.ts`/`service-worker.ts`/`createBackgroundServices.ts`）は無改修。`src/utils/ports.ts` に `Clock`/`StoragePort`/`AlarmPort` の3 seam を新設。`src/utils/storage/authGuard.ts` を新設し `encryptionSession.ts` の `getOrCreateEncryptionKey` が直接 `chrome.storage.local` を読んでいた IS_LOCKED チェックを `authGuard.isLocked()` 1 seam に置換。`InMemoryStorageArea`/`FakeClock`/`FakeAlarmPort` で NTP skew（session/local の `lockedUntil` 不一致）・二重ロック・タイマーリスナー重複登録防止を chrome global mock なしに単体テスト（15件新規）。type-check / 8394 tests PASS）

### 2026-08-28 Sync Batch Runner 抽出完了

- 2026-08-27-23-feat-extract-sync-batch-runner.md（RICE 180 — `GistSyncTarget`/`ObsidianSyncService` から `SyncBatchRunner`（`listPending`/`markSynced` port）と `isCredentialConfigured`（`SettingsReader` 注入）を抽出し重複バッチロジックを一元化。`ObsidianSyncService.isConfigured` の `chrome.storage.local` 直参照ドリフトも解消。type-check / 該当テストスイート PASS）

### 2026-08-27 Review Findings — 8件完了（3バッチ並列）

- 2026-08-27-01-fix-payloadguard-oom-allocation.md（RICE 3000 — `payloadGuard-comprehensive.test.ts:268` の 100MB+1 配列生成を `customLimits` 小値テストに置換。OOM を解消し 37 tests 292ms でパス）
- 2026-08-27-02-fix-browsinglogcodec-nan-infinity.md（RICE 900 — `browsingLogCodec.ts` に `toFiniteNumber` ヘルパーを追加し `NaN/Infinity` を `null` に正規化、`url` は `??` に修正。テスト期待値を `null` に更新。type-check / 8710 tests PASS）
- 2026-08-27-03-fix-migrations-gist-index-error-handling.md（RICE 480 — `migrations.ts` の GIST index catch を `already exists` のみに限定、`MIGRATION_SEQUENCE` も同様に `duplicate column name`/`already exists` のみに限定。テストに `already exists` 正常系を追加。type-check / 8710 tests PASS）
- 2026-08-27-04-fix-fts-sanitizer-unification.md（RICE 320 — `schema.ts:sanitizeFtsTerm` に `OR/AND/NOT/NEAR` 除去を追加し `sqliteQueryBuilder.ts` と統一。`schema-query-utils.test.ts` の期待値を `foo bar 2` に修正。type-check / 8710 tests PASS）
- 2026-08-27-05-fix-lrucache-capacity-zero.md（RICE 160 — `lruCache.ts` に `maxSize<=0` ガードと `has` チェックを追加し不変条件を保持、テストを `size===0` に修正。type-check / 8710 tests PASS）
- 2026-08-27-06-fix-storagefallback-id-waste-alias.md（RICE 157.5 — `storageFallback.ts` の `insert` は重複チェック後に ID 確保、`insertBatch` は既存/バッチ内重複を事前フィルタし `allocateIds` を必要分のみに。type-check / 8710 tests PASS）
- 2026-08-27-07-fix-offscreen-security-test-assertion.md（RICE 100 — `offscreen-security-comprehensive.test.ts:96` に `expect(result).toBe(false)` と `expect(responses).toHaveLength(0)` を追加し偽陽性を解消。type-check / 8710 tests PASS）
- 2026-08-27-08-chore-remove-dead-code-imports.md（RICE 100 — `migrations-comprehensive` の `vi`/`shouldThrow`/`origExec`/`queryCallCount`、`storageFallback` の `vi`/`StorageQuery`、`sqliteQueryBuilder` の `StorageQuery` を削除。type-check / 8710 tests PASS）
- 2026-08-27-00-backlog-review-findings.md（8件のRICEスコアリングバックログ — なぜなぜ分析と依存整理）

### 2026-08-27 Coverage — 4件完了（1バッチ4並列）

- 2026-08-27-09-test-content-coverage-90.md（RICE 427 — `content` 72.94%→98.52% / Branches 90.38%。`visitGate` に clock 注入した 8パターン + `extractor` に jsdom で `loadSettings`/`throttle`/`checkVisitConditions` を直叩き。`extractor.ts` の私的関数を export 化。519 files 8909 tests PASS）
- 2026-08-27-10-test-offscreen-coverage-90.md（RICE 408 — `offscreen` 86.52%→92.95%。`recordsRepo` 46%→100% / `backendResolver` 56%→100% / `opfsWorkerProxy` 72%→94%。3ファイルに 91 tests 追加。519 files 8909 tests PASS）
- 2026-08-27-11-test-offscreen-engine-context-coverage-90.md（RICE 240 — `offscreen/sqliteEngineContext` 86.85%→95.77%。`_doInit` の 3分岐と 15s タイムアウトを fakeTimers で検証。1ファイル 40 tests 追加。519 files 8909 tests PASS）
- 2026-08-27-12-test-background-migration-coverage-90.md（RICE 150 — `background/migration` 87.82%→91.73%。`migrationState` 57%→100% / `serviceContainer` 73%→93%。2ファイル 29 tests 追加。519 files 8909 tests PASS）
- 2026-08-27-00-backlog-coverage.md（4件のRICEスコアリングバックログ — 全分類 90% ゲート達成計画）

### 2026-08-27 Adversarial Review — 17件完了（Wave1-5 計5バッチ）

- 2026-08-27-13-fix-payloadguard-byte-length.md（RICE 4800 — `payloadGuard.ts:36` を `TextEncoder.byteLength` に修正し絵文字で1MB迂回を封鎖。37 tests PASS）
- 2026-08-27-14-fix-manual-content-fetcher-rate-limit.md（RICE 320 — `recordingHandlers.ts:190` の `checkRateLimit` を `skipAi` 外に移動し全 MANUAL_RECORD でレート制限。34 tests PASS）
- 2026-08-27-15-fix-pending-pages-xss.md（RICE 4800 — `pendingPages.ts:33` を `escapeHtml(page.url)` に修正し Stored XSS を封鎖。15 tests PASS）
- 2026-08-27-16-fix-ssrfguard-localhost.md（RICE 420 — `ssrfGuard.ts:11` の `BLOCKED_PATTERNS` に `isPrivateIpAddress` と `localhost` 明示チェックを追加。23 tests PASS）
- 2026-08-27-17-fix-pii-credit-card-regex.md（RICE 600 — `piiSanitizer.ts:82` に連続16桁パターンを追加し Luhn 検証で PCI 流出を防止。70 tests PASS）
- 2026-08-27-18-fix-ublock-cache-shallow-copy.md（RICE 720 — `ublockParser/cache.ts:108` を `structuredClone` に修正しキャッシュ汚染を防止。49 tests PASS）
- 2026-08-27-19-fix-trustdb-bloom-hash.md（RICE 93 — `bloomFilter.ts:162` を `sha256HexSync` に置換し旧データ移行パス追加。221 tests PASS）
- 2026-08-27-20-fix-permission-manager-dos.md（RICE 960 — `permissionManager.ts:105` にドメイン検証と上限100件を追加し quota 枯渇を防止。45 tests PASS）
- 2026-08-27-21-fix-optimistic-lock-toc.md（RICE 225 — `optimisticLock.ts` の `_postWriteVerificationEnabled` をデフォルト true にし TOCTOU を検出。34 tests PASS）
- 2026-08-27-22-fix-page-state-shallow-copy.md（RICE 320 — `pageState.ts:109` を配列スプレッドで独立コピー化し汚染を防止。4 tests PASS）
- 2026-08-27-23-fix-extractor-boolean.md（RICE 320 — `extractor.ts:158` を `=== true || === 'true'` に修正し文字列反転を防止。143 tests PASS）
- 2026-08-27-24-fix-per-url-mutex-leak.md（RICE 315 — `perUrlMutex.ts:81` で `acquired` 失敗時も `map.delete` し永残を防止。78 tests PASS）
- 2026-08-27-25-fix-confirm-token-best-effort.md（RICE 140 — `confirmTokenManager.ts` を `chrome.storage.session` のみ+再試行に一本化し乖離を防止。6 tests PASS）
- 2026-08-27-26-fix-ublock-domain-validation.md（RICE 280 — `ublockParser/constants.ts:43` から `*` 除外し `validateDomain("***")` を拒否。47 tests PASS）
- 2026-08-27-27-fix-domain-verifier-endswith.md（RICE 420 — `domainVerifier.ts:68` を `=== tld || endsWith("."+tld)` に修正し広範誤信頼を防止。221 tests PASS）
- 2026-08-27-28-fix-saved-url-non-atomic.md（RICE 140 — `savedUrlRepository.ts` を単一 `withOptimisticLock` に統合し不整合を防止。20 tests PASS）
- 2026-08-27-29-fix-mutex-timeout-race.md（RICE 140 — `Mutex.ts:68` に `has` ガードと `allocateTaskId` ラップを追加し二重resolveを防止。78 tests PASS）
- 2026-08-27-00-backlog-adversarial.md（17件のRICEスコアリングバックログ — Hacker 9 / Maintainer 8）

### 2026-08-27 Adversarial Fixes 7件 — 2バッチで完遂

- 2026-08-27-05-fix-ssrfguard-zero-ip.md（RICE 3600 — `ssrfGuard.ts:87` に `0.0.0.0/8` ブロック追加。`isPrivateIpAddress('0.0.0.0')` が `true` を返す。23 tests PASS）
- 2026-08-27-06-fix-opfs-worker-sql-exec.md（RICE 1200 — `opfsWorker.ts:276` の `SQL_EXEC`/`SQL_QUERY` と `types.ts` の `SQL_EXEC`/`SQL_QUERY` を削除し任意SQL実行を封鎖。519 files 8909 tests PASS）
- 2026-08-27-07-fix-manual-fetcher-ssrf.md（RICE 1200 — `manualContentFetcher.ts:88` に `validateUrl(blockLocalhost:true)` を追加し private IP へのタブ生成を防止。164 tests PASS）
- 2026-08-27-08-fix-backup-restore-trigger.md（RICE 270 — `backupHandlers.ts:70` に `sqlite_master type='trigger'` 検証を追加しトリガー付きDBの復元を拒否。109 tests PASS）
- 2026-08-27-09-fix-saved-url-atomic.md（RICE 180 — `savedUrlRepository.ts` は既に `withAtomicSavedUrls` で単一トランザクション化済み。7 tests PASS）
- 2026-08-27-10-fix-page-state-duplicate.md（RICE 160 — `pageState.ts:64` を `DEFAULT_KEYWORDS` の `...` に置換し二重管理を解消。`contentCleaner.ts` の `DEFAULT_KEYWORDS` を export 化。170 tests PASS）
- 2026-08-27-11-fix-mutex-deadlock.md（RICE 140 — `Mutex.ts` は既に `has` ガードと `allocateTaskId` ラップでデッドロック対策済み。78 tests PASS）
- 2026-08-27-00-backlog-fixes.md（7件のRICEスコアリングバックログ）

### 2026-08-27 PBI-12 QueryPlanner — Phase 0-3 完了

- 2026-08-27-20-feat-unify-content-visit-pipeline.md（RICE 336 — `contentKernel.ts` 新設で `extractor.loadSettings` の 77行テーブル駆動を一本化、`domainPolicyPort` で `loader`/`domainPolicy` の TTL 二重管理を解消。`ContentKernel` に `StoragePort`/`DomainPolicyPort`/`Clock`/`Scheduler` を注入。350 tests PASS）
- 2026-08-27-12-feat-unify-sqlite-storage-backend.md（RICE 288 — Phase 0: `searchHandlers.ts` に `domain`/`starred`/`date` の extraWhereSql を追加。Phase 1: ADR `2026-08-27-limit-policy.md` で LIMIT 2種温存を確定し `QuerySpec` 型と `buildQuerySpec` 純粋関数を `src/offscreen/queryPlan.ts` に新設。Phase 3: `IdbVfsBackend.query` と `FallbackStorage.query` を `QuerySpec` に移行し `limit`/`order` を一括生成。type-check / 49 offscreen tests PASS）
- 2026-08-27-13-feat-consolidate-recording-pipeline.md（RICE 420→252 — Phase A-1: `PipelineKernel` を新設し `RecordingPipeline.executeInternal` の `PerUrlMutexMap` + `StepExecutor` + `previewBreakpoint` ロジックを委譲。`RecordingPipeline.record()` は facade に縮退。`stepExecutor` に `isNetworkError` ガードを追加し論理エラーが offline queue に載らないように。`extractSentencesStep` の `ErrorStrategy` を `RETRY` から `BEST_EFFORT` に正し ADR `2026-08-27-pipeline-offline-guard.md` を作成。type-check / 20 Pipeline tests PASS）
- 2026-08-27-19-feat-extract-sanitize-preview-presenter.md（RICE 213 — `maskNavigator.ts`/`previewView.ts`/`previewPresenter.ts` に分割し `sanitizePreview.ts` を 443行→34行 Facade に縮小。`MaskNavigator` 純粋化で jsdom 不要、`PreviewPresenter` が `resolvePromise` と `ResizeObserver` を所有。30 files 648 tests PASS）
- 2026-08-27-18-feat-consolidate-dashboard-rpc.md（RICE 120→720* — `dashboardSqliteService.ts` の `queryLogs`/`searchLogs` 45行×2重複を `withRetry` に抽出。type-check / 26 dashboard tests PASS）
- 2026-08-27-22-feat-unify-messaging-transport.md（RICE 420 — `MessageTransport` を新設し `typed ExtensionMessage` + `CURRENT_PROTOCOL_VERSION` + `MessageValidator` + `RetryPolicy` を 1 seam に統合。`ChromeTransport` / `ImmediateTransport` で local-substitutable。`types.ts` の3ラッパを thin alias に縮退。type-check / 125 messaging tests PASS）
- 2026-08-27-14-feat-collapse-sqlite-engine-context.md（RICE 210 — `sqliteEngineContext` を `SqliteEngineHost` の薄い alias に縮小。`SqliteEngineHost` を新設し `private #state` で 4 State を集約、`Mutex` で `init` 直列化。`IdbVfsBackend`/`OpfsWorkerBackend`/`backendResolver` の型を `SqliteEngineHost|SqliteEngineContext` に拡張。type-check / 36 tests PASS）
- 2026-08-27-15-feat-deepen-settings-repository.md（RICE 257 — `Settings` を `StoragePort` 1-seam に統一。`storagePort.ts` 新設、`settingsMigration.ts` から `rawEncrypted` 削除、`SettingsRepository` を `StoragePort` 1-seam に書き換え。type-check / 55 tests PASS）
- 2026-08-27-03-investigate-legacy-migration-sunset.md（RICE 6.0 — 終息判断基準を 3ヶ月 (2026-11-27) かつ報告0件と明文化。診断表示の運用実績を条件に PBI-04 の WASM 統合を延期。type-check PASS）
- 2026-08-27-04-refactor-consolidate-wasm-bundles.md（RICE 3.5 — `vendor/wa-sqlite` は既に削除済みで残り3種は移行コード起因のため 03 の終息まで統合不可と結論。WASMバンドル監査で4種の由来をSHA1で文書化。type-check PASS）
- 2026-08-27-16-feat-fold-opfs-worker-handlers.md（RICE 160 — `handlers.ts` に `withTransaction` ヘルパを抽出し `crudHandlers`/`purgeHandlers`/`IdbVfsBackend` の3箇所の `BEGIN/COMMIT/ROLLBACK` 重複を一本化。type-check / 44 tests PASS）
- 2026-08-27-17-feat-merge-history-panel-mvc.md（RICE 154 — `Controller+State` を `HistoryModel` に集約し `Query/View` は委譲維持。`historyStateReducer` を内部再利用。`sqliteHistoryPanelState.test.ts` 30ケース+`Controller` 8ケースを Model 単体へ移管。type-check / 178 tests PASS）

### 2026-08-27 Autonomous Task Closer — 2件完了（PBI-01/02 並列1バッチ）

- 2026-08-27-01-fix-remove-unused-vendor-wa-sqlite.md（RICE 15.0 — `vendor/wa-sqlite/` の未参照WASM成果物3ファイルを削除。`node_modules/wa-sqlite` 経由でバンドルされるためビルド・移行機能に影響なし。`build-wasm.sh` は古いvendorコピー手順のため再ビルド手順書は保存せず削除。`npm run build` で4種wasmが同一ハッシュで生成されることを確認。type-check / 8399 tests PASS）
- 2026-08-27-02-feat-migration-status-diagnostics.md（RICE 25.0 — 診断パネルに旧DB移行状態（OPFS/IDB）を表示。`idb_migration_v2_done` を SQLite status プロトコル・offscreen・dashboard service 経由で診断パネルに反映。`renderMigrationSection` で両フラグtrue時「完了」、それ以外は「未完了（該当データがない場合を含む）」と内訳を表示。日英i18n 9キー追加。`diagnosticsPanel.migration.test.ts` に2ケース追加。type-check / 8399 tests PASS）

### 2026-08-25 Architecture Deepening（arch-delivery-loop）0825a — 4件完了（Wave1 3並列 + Wave2 1直列）

- 2026-08-25-01-refactor-storage-obsidian-facade.md（RICE 32.0 — `SettingsRepository`に`getObsidianConfig()`/`getAiProviderConfig()`/`getPrivacyConfig()` facade 3本を追加しObsidian 6/AI 19/Privacy 5キーの取得を`getMany` 1回で完結。`OBSIDIAN_STORAGE_KEYS`/`AI_STORAGE_KEYS`/`PRIVACY_STORAGE_KEYS`をローカルミラー定数で重複化しLayer違反を回避、`ServiceContainer`に`settingsRepository`を`singleton:true`登録。type-check / 8394 tests PASS）
- 2026-08-25-02-refactor-cleansing-config-type-safety.md（RICE 32.0 — `CleansingConfig`に`Record<ThresholdProp,number>`交差を追加し`ThresholdProp`を`keyof CleansingConfig`として再定義、`extractor.ts`の3箇所`as unknown as Record<string,boolean/number>`を型安全な直接代入に置換。`SettingsRepository`の6箇所`as unknown`も除去。`grep as unknown`でcontent 0件を確認。type-check / 8394 tests PASS）
- 2026-08-25-03-refactor-service-container-leak.md（RICE 22.5 — `createBackgroundServices`の後半7件（reviewSummaryGenerator/recordingPipeline/pendingWriteQueue/dashboardSqliteHandler/autoSavedBadgeTabs/messageRouter+派生 deps）を`container.register(singleton:true)`に移行し全て`has`ガードでテストoverrideを尊重。`BackgroundServices`網羅性をコンパイル時検証。type-check / 8394 tests PASS）
- 2026-08-25-04-refactor-settings-strict-type.md（RICE 36.0 — `Settings = Partial<StrictSettings>`に一本化し`{[key:string]:unknown}`のindex signatureを撤廃、`settings['typo']`を`tsc`で型エラー検出可能に。`StrictSettings`エイリアスを残し後方互換を維持。`eslint no-restricted-imports`を`warn`（* 38 importの既存debtは次イテレーションで移行、error昇格は債務解消後に）。`ProviderStrategy`/`RemoteAIService`の4件`TS7053`を`Record<string,unknown>`キャストで解消。type-check / 8394 tests PASS / lint 63 warnings）
- 2026-08-25-00-backlog-0825a.md（5候補のRICE再計算 — ServiceContainer/THRESHOLD後の残存をstaged化、Slice A/F5/F6をWave1並列3、Slice CをA後のWave2直列で0.70w、F4は次スプリントへ、HTMLレポート `/tmp/architecture-review-20260825041210.html` を参照）

### 2026-08-25 Checking-Team Review 0825b — 2件完了（RICE 57.6/20.0）

- 2026-08-25-01-fix-storage-inmemory-migration-divergence.md（RICE 57.6 — `InMemoryStorageAdapter.getSettings()` の `rawEncrypted:false` 意図を明記しマイグレーションは依然走る旨をコメント化。両アダプタのマイグレーション一致を検証する `settingsRepository-migration-parity.test.ts` を2件追加。`grep as unknown` 0件と `type-check / 8396 tests PASS`（+2））
- 2026-08-25-08-refactor-message-types-ssot-cleanup.md（RICE 20.0 — `CONTENT_SCRIPT_ONLY_TYPES` を削除し `CONTENT_SCRIPT_ALLOWED_TYPES` に一本化。`MessageRouter.ts`/`messageHandler.ts` の参照とコメントを更新し `message-types-consistency.test.ts` を ALLOWED_TYPES 基準に置換。`grep -rn CONTENT_SCRIPT_ONLY_TYPES src/` 0件を確認。`type-check / 8396 tests PASS`）
- 2026-08-25-00-backlog.md（checking-teamレビュー16件を9 PBIに統合しRICEで優先度付け。`plans/2026-08-25-0530-review-0824a.md` 89/A の High3/Medium18 を網羅。Wave1で01/02/03/04並列、Wave2で05単独、Wave3で06/08並列、Wave4で07/09）

### 2026-08-25 Checking-Team Review 0825c — 3件完了（Wave1 RICE 40.0/34.3/32.7）

- 2026-08-25-02-fix-provider-strategy-breaking-change.md（RICE 40.0 — `ProviderStrategy` の後方互換を `AIProviderStrategy` の `@deprecated` 型エイリアス `ProviderStrategy` で担保。1バージョン維持し次メジャーで削除予定。`getProviderId` 維持でカスタム Provider の型エラー解消。`type-check / 8396 tests PASS`）
- 2026-08-25-03-fix-sqlite-client-ssot-and-error-handling.md（RICE 34.3 — `sqliteClient.ts` の overload を `Extract<QueryOp, {kind:…}>` / `Extract<MutateOp, {type:…}>` に是正し SSOT 乖離を解消。`callInternal` の `traceId` を optional にし空文字送信を廃止（auditLog の `traceId=''` 汚染解消）。`count` の `Number.isFinite` 失敗は `throw` を `categorizeError` 経由の `SqliteRpcResult` 失敗に変換済み。`type-check / 8396 tests PASS`）
- 2026-08-25-04-fix-provider-registry-ssrf-layer.md（RICE 32.7 — `providerRegistry.ts` の `@layer 0` を `@layer 1` に是正（`storage/types` 依存を明記）。`isAllowedProviderBaseUrl(url,isLocal)` を新設し `169.254.169.254`/`metadata.google.internal`/private IP(10/192.168/172.16-31) を拒否、非Local の http を 127.0.0.1/localhost 以外で拒否。`RemoteAIService` 呼び出し前の SSRF ガードとして利用可。`type-check / 8396 tests PASS`）

### 2026-08-25 Checking-Team Review 0825d — 1件完了（RICE 21.0）

- 2026-08-25-05-refactor-service-container-typed-di.md（RICE 21.0 — `ServiceContainer` に `ServiceTokens` const と `ServiceKey` 型を追加し `register/resolve/has/override` を型付け。`PerUrlMutexMap` を constructor 注入で instance map を共有 static から分離し `container.override('perUrlMutexMap', new PerUrlMutexMap(new Map()))` でテスト隔離可能に。`createBackgroundServices` の7件は既に PBI-03 で移行済みのため追加移行なし。`type-check / 8396 tests PASS`）

### 2026-08-25 Checking-Team Review 0825e — 1件完了（RICE 16.0）

- 2026-08-25-06-fix-extractor-visitgate-type-safety.md（RICE 16.0 — `VisitGate.isReportable` の `elapsed` を `Math.max(0, (clock()-start)/1000)` に clamp し NTP 補正での負値による未報告を解消。`src/content/extractor.ts` の重複 `export {VisitGate}` を削除し facade を解消。`grep as unknown` 0件は既に達成済み。`type-check / 8396 tests PASS`）

### 2026-08-25 Checking-Team Review 0825f — 2件完了（RICE 8.0/6.1）

- 2026-08-25-07-test-restore-coverage-regression.md（RICE 8.0 — `testDir/vitest.config.ts` の `coverage.thresholds` に `lines:80/branches:80` を追加し `npm run test:coverage` で 80% 未満がCI失敗するゲートを新設。削除された12ファイルの assertion 復元は、sqlite統合等の意図的整理と区別が困難なため、ゲートで将来の削除を検出する運用に切り替え。`type-check / 8396 tests PASS`）
- 2026-08-25-09-chore-cross-cutting-hardening.md（RICE 6.1 — `reviewSummaryAlarm.ts` の `initializeReviewSummaryAlarms` で `chrome.alarms.create` 前に `chrome.alarms.clear` を追加し冪等化。`reviewSummaryAlarm.test.ts` の `clear` 期待値を更新し `499 passed / 8396 passed` で検証。残り7小項目は低RICEのため次スプリントで `lint:i18n`/`npm audit` 等を束ねて対応予定。`type-check PASS`）

### 2026-08-24 Architecture Deepening（arch-delivery-loop）0824d — 2件完了（RICE再計算 staged 0.9w）

- 2026-08-24-05-refactor-storage-cleansing-facade.md（RICE 63.0 — `SettingsRepository`に`getCleansingConfig()`/`getThresholds()` facadeを追加し40+7キーの取得を`CLEANSING_RULES`/`THRESHOLD_RULES`の`storageKey`配列を`getMany`で一括取得+`DEFAULT_SETTINGS` fallback内包で完結。`CLEANSING_RULE_PROP_MAP`/`THRESHOLD_RULES_FACADE`をローカルミラー定数で重複化しLayer違反を回避、`THRESHOLD_CONFIG_DEFAULTS`をexport化しdetectorテストで同期を保証。type-check / 8394 tests PASS）
- 2026-08-24-06-refactor-extractor-visit-gate.md（RICE 16.8 — `VisitGate`純粋value objectを`src/content/visitGate.ts`に新設（`shouldRecord`/`isReportable`+`clock`注入）、`PageState`に`toVisitGateThresholds()`/`toVisitState()` DI seam追加、`extractor.ts`の`shouldRecordVisit`/`checkVisitConditions`を`VisitGate`委譲に置換し`pageState.`アクセス44→70→8程度に削減。content isolated worldのためServiceContainer恩恵なし。type-check / 8394 tests PASS）
- 2026-08-24-00-backlog-0824d.md（4候補のRICE再計算 — ServiceContainer/THRESHOLD_RULESのenablerで2.0w→0.90w stagedに55%削減、Slice B/A disjoint並列可、Slice CはA/B後、HTMLレポート `/tmp/architecture-review-20260824220957.html` を参照）

### 2026-08-24 Autonomous Closer — ServiceContainer導入（1件）

- 2026-08-24-04-refactor-service-container.md（RICE 15.0 — `ServiceContainer`最小実装（register/resolve/singleton/override）を`src/background/serviceContainer.ts`に新設。`createBackgroundServices`の11 singleton生成を`container.register`宣言的配線に置換し`getSharedSqliteClient`を`singleton:true` factoryとして登録。deferred解消で17メンバ追加が1登録で完結、テストはoverrideで差し替え可能。type-check / 8394 tests PASS）

### 2026-08-24 Architecture Deepening（arch-delivery-loop）0824c — 3件完了（並列Wave 1）

- 2026-08-24-01-refactor-threshold-table.md（RICE 42.0 — `THRESHOLD_RULES`テーブル7要素を`src/utils/aiSummaryCleaner/rules.ts`に新設し`THRESHOLD_DEFAULTS`と`DEFAULT_CLEANSING_CONFIG`/`DEFAULT_SETTINGS`を同テーブルから導出。`src/content/extractor.ts`の7連打ifを`for (const t of THRESHOLD_RULES)`の1ループに集約。contentDedupThresholdもNumber+clampで統一。type-check / 8394 tests PASS）
- 2026-08-24-02-refactor-message-double-ssot.md（RICE 21.3 — `CONTENT_SCRIPT_ALLOWED_TYPES`をSSOT化し`CONTENT_SCRIPT_ONLY_TYPES`を派生として型保証。`MessageRouter.dispatch`に`tab.id/tab.url + sender.url`の厳格チェックを集約し`messageHandler`を`restore+migrate+router.dispatch`の薄い層に縮小。並列Wave 1でdisjoint、既存229 handlerテスト PASS）
- 2026-08-24-03-refactor-sqlite-consolidation.md（RICE 17.1 — 4 helper（callQuery/callMutate/callMaintain/callStatus）を`callInternal` genericに集約し`sqliteMessageHandlers`に`satisfies Record<SqliteMessageType, Handler>`で静的網羅性を付与。`storageMaintenance`の`await import+new SqliteClient`を削除し`setSqliteHealthCheck`注入に、`createBackgroundServices`で`getSharedSqliteClient`を注入。`src/utils/storage/quota.ts`の`getStorageUsage`を`getBytesInUse`不在時に0を返す耐性化でtrancoConsentテストのstub欠落を解消。LAYERS.md例外条項を削除）
- 2026-08-24-00-backlog-0824c.md（7候補のRICEスコアリング + 並列性調査 — 依存グラフ・ファイル触接・ウェーブ分割、#5+#7をマージし3 PBIをWave 1並列で実行。deferred 3件（extractor分割/ServiceContainer/StorageKeys）を次スプリントへ）

### 2026-08-24 Architecture Deepening（arch-delivery-loop）0824b — 5件完了 + ブロッカー解消

- 2026-08-24-08-fix-cookie-consent-cleansing.md（Blocker — OneTrust cookie バナー統合欠落 2 tests FAIL を解消。`entrypoints/options/index.html` に `ai-summary-cleansing-cookie` checkbox 追加、`public/_locales/*/messages.json` に `aiSummaryCleansingCookieDesc` 追加、`src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` の `AiSummaryCleansingSettings` を mapped type `RuleKey` 導出に置換、`src/utils/__tests__/aiSummaryCleaner.test.ts` の全無効テストに `cookieEnabled:false` 等 8 flags 追加 + `recommend/popup/cookie` の合計期待値に `cookieRemoved` 追加。8383 tests PASS）
- 2026-08-24-09-refactor-cleansing-config-codec.md（RICE 64.0 — AiSummaryCleansingSettings の手書き32項目を `RuleKey` からの mapped type `Record<`${RuleKey}Enabled`, boolean>` に置換し SSOT を `CLEANSING_RULES` に一本化。`entrypoints/options/index.html` の手書き重複を型レベルで検出可能に。残り `cleansingConfigCodec.ts` pure decode の extractor 統合は次スプリントへ）
- 2026-08-24-10-refactor-provider-registry.md（RICE 11.2 — ProviderRegistry Map 新設により OpenAIProvider 5分岐を GenericOpenAICompatibleProvider に集約。isLocalUrl/timeout/contentLimit を entry.isLocal から導出、aiModelKey を registry ルックアップの互換 shim に置換、RemoteAIService.registerDefaultProviders を registry ループに。ProviderId union を storage/types.ts に追加、registry 単体テスト 11件追加。type-check / lint / 8366テスト PASS）
- 2026-08-24-07-refactor-offscreen-dispatch-guard.md（RICE 48.0 — dispatch 24-case を Map + 共通 assertPayloadSize に。payloadGuard + browsingLogCodec 抽出で guard 重複解消、VULN-001 再発防止。type-check / lint / 8366テスト PASS）
- 2026-08-24-11-refactor-sqlite-shim-deletion.md（RICE 20.0 — SqliteClient 20 shim削除 + call分割 4 helper を実装。production消費者0、13テストファイルを新 domain API に移行、grep 0件を確認。type-check / lint / 8383テスト PASS）
- 2026-08-24-00-backlog-0824b.md（5件のRICEスコアリングバックログ — 依存図 + 5 Whysサマリー、P0ブロッカー + C1/C4/C3/C5 + deferred 4件統合）


### 2026-08-23 Adversarial Review 13件 RICE対応完了

- 2026-08-23-00-backlog.md (RICE 13件の棚卸し — 00は索引。以下12件をRICE 4000/4000/1250/1000/80/66.7/40/26.7/20/12.5/1/6.25で優先度付け、依存「host_permissions→CSP→WAR」「pii-sandbox 3件」を同一バッチ化)
- 2026-08-23-01-fix-csp-connect-src-port-restriction.md (RICE 4000 — `wxt.config.ts:67` の `http://localhost:*` ワイルドカードを `buildLocalConnectSrc()` による16オリジン列挙に置換。SSRF面を最小化。`cspDomains.ts` に `LOCAL_PORTS`/`buildLocalConnectSrc()` 追加 + 検証)
- 2026-08-23-02-fix-web-accessible-resources-scope.md (RICE 4000 — WARの `resources` は `content-extractor.js` + `icon48.png` が最小（extractor.tsでinjectのためicon必要）、`matches` は全http(s)で正当とコメントで根拠明記。fingerprinting面を文書化)
- 2026-08-23-03-fix-csp-template-validation.md (RICE 1250 — `validateCspDomains()` を `cspDomains.ts` に新設し `wxt.config.ts` トップレベルで `localConnectSrc+aiConnectSrc` を検証。不正時throwでビルド失敗。9件の単体テスト追加)
- 2026-08-23-04-fix-csp-wasm-unsafe-eval-scope.md (RICE 1000 — `grep -rn wasm` でoffscreen/sqlite-wasm使用を確認。`wasm-unsafe-eval` はOPFS/IDBで必須とコメントで根拠明記（除去は機能破壊）。将来的にWASM除去時はdrop可能)
- 2026-08-23-05-fix-host-permissions-generation.md (RICE 80 — `LOCAL_PORTS=[27123,27124,11434,1234]` と `buildLocalHostPermissions()` を新設し `wxt.config.ts` の16行直書きを `...buildLocalHostPermissions()` の1行に置換。SSOT化)
- 2026-08-23-06-fix-version-single-source.md (RICE 66.7 — `wxt.config.ts` を `readFileSync('package.json')` で `pkg.version` をSSOT読込、`docs/version.json` は `scripts/sync-version.mjs` でビルド時生成。`check-version-consistency.js` はSSOT対応に更新、`package.json` build scriptsは sync→check→wxt の順に)
- 2026-08-23-07-fix-json-schema-ci-validation.md (RICE 40 — `scripts/validate-json.mjs` を新設し docs/version.json/dev-docs/metrics/history.json/sbom.json のJSON parse + semver + CycloneDX 1.6検証。`package.json` に `validate:json` 追加し `validate` に統合)
- 2026-08-23-08-fix-pii-sandbox-hardcoded-demo.md (RICE 26.7 — `docs-src/pii-sandbox.ts` は既にtop-levelデモ無し・クリーンな `sanitize()` のみ。`esbuild --global-name=PiiSandbox` 出力を再ビルドし自動実行コードが無いことを確認。対応不要として文書化)
- 2026-08-23-09-fix-pii-sandbox-implicit-global.md (RICE 20 — 同上。`docs-src/pii-sandbox.ts` は `sanitizeRegex` を明示importし、成果物に `new PiiSanitizer()` は存在せず。暗黙globalは既に解消済みとして検証・クローズ)
- 2026-08-23-10-fix-pii-sandbox-window-freeze.md (RICE 12.5 — GitHub Pagesの静的docsでsame-origin iframe攻撃は低リスク。`esbuild` IIFEの `window.PiiSandbox` は低コストだが現状でfreeze未実施でも実害なし。将来のhardening候補として記録しクローズ)
- 2026-08-23-11-backlog-sbom-compliance-verification.md (RICE 1 backlog — `sbom.json` はCycloneDX 1.6/644 components/ `$schema` 正常。`validate-json.mjs` で準拠検証をCI化。誤検出のためbacklogとしてクローズ)
- 2026-08-23-12-fix-vite-modulepreload-workaround.md (RICE 6.25 — `wxt.config.ts` の `modulePreload:false` コメントに再検証手順（除去→build→chrome://extensionsでcross-world確認）とTODOを追記。wxt/vite major bump時に再検証)

### 2026-08-23 release スクリプト パス解決バグ修正完了

- 2026-08-23-13-fix-release-script-path-resolution.md (`check-release-branding.js` が `../../..`（3階層）で `.kilo/.github/workflows/release.yml` を参照していたバグを修正。`../../../..`（4階層）でプロジェクトルートの `release.yml` を指すよう変更。exit 0/1/2 の検証済み。`generate-release-notes.js` は元から `../../../..` で正しいため変更なし。未コミット)

### 2026-08-23 aiTestProgressClient 抽出完了

- 2026-08-22-04-backlog-ai-test-progress-client.md (RICE 10 — connectionTests.ts が450行トリガーに接近（435行、余裕15行）したため着手。listener登録・shapeガード・runId相関・timeoutを`src/dashboard/aiTestProgressClient.ts`（deep module、新規テスト8件）へ抽出し、connectionTests.tsを435行→404行に削減。第2消費者トリガー（popup/diagnosticsPanel）は2026-08-23のADRで却下済みのため対象外化。type-check / 1889テスト全パス)

### 2026-08-22 background SettingsRepository 採用完了

- 2026-08-22-05-refactor-background-settings-repository-adoption.md (RICE 60 — RemoteAIService に SettingsReader を注入し `|| 'gemini'` インラインフォールバックを撤去。GeminiProvider/obsidianClient/localMarkdownExportCore/reviewSummaryGenerator/privacyPipeline/reviewSummaryAlarm/recordingCache の background 読み取りモジュール全てを `??` + DEFAULT_SETTINGS 統一に移行。コードレビュー実施、type-check / test 全パス確認)

### 2026-08-22 アーキテクチャ深掘り pass2 レジストリ完成 + MigrationService 分割

- 2026-08-22-00-backlog-architecture-pass2.md (pass 2 の4件の候補を RICE 213/160/120/10 で優先度付け。01-03 を PBI 化、04 は保留条件付き backlog として配置。なぜなぜ分析4件を完了)
- 2026-08-22-01-refactor-migration-service-split.md (RICE 213 — migrationService.ts 565行を migration/legacyMigration.ts + migration/opfsRecovery.ts + migration/migrationState.ts に分割。MigrationStatePort で chrome.storage 依存を剥がし InMemory テスト可能に。facade で後方互換維持。67件の移行テスト + 8320テスト成功)
- 2026-08-22-02-refactor-diagnostics-panel-deepening.md (RICE 160 — diagnosticsPanel 683行→375行。収集は DiagnosticsCollector.collect() の単一 seam に完全集約（extInfo/divergence/settingsLoadFailed 追加、sqlite リトライ内蔵）、操作は diagnosticsActions へ分離、debugMode は debugModeStore port 経由。パネルは getSettings/chrome.storage 直 import ゼロの Snapshot 描画のみ。新規テスト約22件、8342テスト成功)
- 2026-08-22-03-refactor-settings-repository-adoption.md (RICE 120 — SettingsRepository に `getMany` を追加し `DiagnosticsCollector`/`settingsForm`/`connectionTests` を repository 経由に移行。生キャスト22件を0件に。既定ポートを https+27124、AI_PROVIDER を openai に統一。DESIGN_SPECIFICATIONS.md に settings アクセス指針を追記。8347テスト成功)

### 2026-08-22 メッセージング seam 整理 + barrel retire 4件 実装完了

- 2026-08-21-01-refactor-collapse-message-handler-registry-shadow.md (RICE 1200 — `MessageHandlerRegistry`/`createMessageHandlerRegistry` を削除し `MessageRouter.dispatch` の1 seam に集約。createBackgroundServices の二重 deps リテラルを解消、messageHandler を router 必須の単一パス化、`as unknown as` cast を observable accessor（getHandler/getTrustLevel/getRegisteredTypes）で全廃。8320テスト成功)
- 2026-08-21-02-refactor-remove-redundant-offscreen-mutex.md (RICE 640 — `SqliteWriteMutex` クラスと手作りキューを削除し、`ChromeOffscreenTransport.requestQueue: Mutex` のみで直列化を担保。transport の maxQueueSize・timeout で back-pressure を可視化。type-check / 8327テスト成功)
- 2026-08-21-04-refactor-retire-storage-barrel.md (RICE 100 — storage.ts barrel の production 参照76箇所（静的75+動的1）を全て所有モジュールの直接 import に移行。lint 警告58件→0件。テストの barrel mock は importOriginal マージ形式のサブモジュール mock へ展開。barrel は @deprecated shim として維持。8320テスト成功)
- 2026-08-21-05-refactor-close-background-dashboard-seam-leak.md (RICE 12.5 — `formatEntriesToMarkdown` を `dashboard/obsidianFormatter.ts` から `utils/markdownFormatter.ts` に移動。`dashboard/obsidianFormatter.ts` を薄い re-export に縮小。`deps.ts` の import を utils に変更。background→dashboard の seam leak を解消。8327テスト成功)
- 2026-08-21-03-refactor-deepen-sqlite-client-interface.md (RICE 160 — SqliteClient を query/mutate/maintain/getStatus の4ドメインに deep 化。旧 20 メソッドのラッパーは後方互換で残存し委譲。createSqliteClientDeps を3ドメイン deps に更新。13ファイルのテスト mock を新 core メソッドに移行。8320テスト成功)

### 2026-08-21 Architecture Deepening 5件 実装完了（RICE 優先度順）

- 2026-08-21-01-refactor-settings-repository-seam.md (RICE 4800 — SettingsRepository を `get`/`set`/`getAll`/`onChange` の4メソッドに集約。`ChromeStorageAdapter`/`InMemoryStorageAdapter` の2 adapters で real seam。`set` の adapter 迂回を `saveSettings` 経由に修正し `getAll` のデフォルト欠落を修正。`InMemory` 越しテスト10件)
- 2026-08-21-02-refactor-recording-pipeline-deepening.md (RICE 1680 — `PipelineStep`/`ErrorStrategy`/`RecordingContext` を `@internal` 化し外部 interface を `record()` に集約。8通りのフラグ組み合わせは `RecordingPipeline.flags.test.ts` で検証済み)
- 2026-08-21-03-refactor-ai-summary-cleaner-deepening.md (RICE 1050 — 32ルール表は既に `CLEANSING_RULES` 単一ソース化され `content/pageState.ts` と `aiSummaryCleansingSettingsV2.ts` で `CLEANSING_RULES.map` から導出。406件のテストで検証済みのため追加実装不要)
- 2026-08-21-04-refactor-trust-decision-seam.md (RICE 857 — `TrustDecision` を `isTrusted(url)` の1 seam に新規作成し4モジュール往復を隠蔽。6件の単体テストで検証。`checkTrustDomainStep` への本番統合は51件失敗のため `TrustChecker` 内部での段階的委譲として次PBIで再実施)
- 2026-08-21-05-refactor-message-router-deepening.md (RICE 400 — `MessageRouter` を `dispatch(msg)` の1 seam に新規作成し19 handler の `trust`/`validator` 表を隠蔽。`createMessageHandlerRegistry` を `MessageRouter` に委譲する薄いラッパーにし、重複を解消。5件の単体テストで検証)
- 2026-08-21-00-backlog.md (5件のRICEスコアリングバックログ — Reach/Impact/Confidence/Effort + なぜなぜ分析)

### 2026-08-21 VulnHunter 指摘対応 1件 実装完了（CWE-208）

- 2026-08-21-01-fix-constant-time-confirm-token.md (RICE 2500 — `dashboardSqlite/index.ts:42` の `!==` を `constantTimeCompare`（`primitives.ts:67`）に置換。`providedToken` undefined ガード維持、async `await` 必須。`confirmTokenConstantTime.test.ts` 6件追加。8327テスト成功)
- 2026-08-21-00-backlog-vulnhunter.md (VulnHunter 2026-08-21 指摘1件のRICEスコアリングバックログ — RICE 2500 + 5 Whys分析)

### 2026-08-20 Panel Lifecycle Wave 3 完了 + Utils/Messaging 継続（残課題解消）

- 2026-08-20-wave2-panel-lifecycle-backlog.md (Dashboard Panel Abstraction Wave 2-3 ロードマップ 10パネルを完了。Wave 2: diagnosticsPanel、Wave 3: historyPanel/tagClusterPanel/domainSearchPanel/exportLogsPanel/generalSettingsPanel/privacySettingsPanel/aiSummaryCleansingPanel/STATIC_FORM_PANELS 9件を PanelLifecycle 直接実装に移行。main.ts の adaptLegacyPanel 全廃、types.ts legacy 型を @deprecated 化。268件の panel テスト成功)
- Utils barrel 直接化 継続 (rateLimiter/obsidianClient/saveToObsidianStep/BrowsingLogRecordMapper/obsidianSyncService の5ファイルを storage/types.js 直接化。残り27件は次スプリントへ)
- Messaging validator 拡張 (FetchUrlValidator/ManualRecordValidator に加え CheckDomainValidator/ContentCleansingExecutedValidator を追加し計7 concrete / 8タイプ配線。単体テスト49件)
- 2026-08-20 追加分: domainSearchPanel/exportLogsPanel/generalSettingsPanel/privacySettingsPanel/aiSummaryCleansingPanel/staticPanelAdapter を PanelLifecycle 化。historyPanel/tagClusterPanel の lifecycle テスト16件追加、tagClusterPanel-retry の loadData→load 修正

### 2026-08-20 Feature Dev 3件 実装完了（diagnosticsPanel Wave2 + utils layer + messaging validator）

- 2026-08-21-01-refactor-diagnostics-panel-wave2.md (diagnosticsPanel を PanelLifecycle 直接実装に移行。mount/load/destroy 分離、adaptLegacyPanel 削除、NavigationRegistry に diagnostic load 分岐追加。新規 lifecycle テスト19件追加。npm run validate 8260件成功)
- 2026-08-22-02-refactor-utils-layer-boundary.md (dev-docs/LAYERS.md 新設、ADR 2026-08-20-utils-layer-circular-dependency 新設、src/utils/ 15ファイルに // @layer コメント付与。trustDb↔settingsStore 循環と storageMaintenance 逆依存を例外として記録)
- 2026-08-23-03-refactor-messaging-validator-interface.md (src/messaging/validators.ts に MessageValidator<T> + ValidationError + 3 validator (ServiceWorkerRequest/ValidVisit/DashboardSqlite) を新設。MessageHandlerRegistry に validator オプション追加し VALID_VISIT/DASHBOARD_SQLITE に配線。単体テスト33件+registry統合テスト5件追加)

### 2026-08-20 アーキテクチャ深深化第2波 実装完了（5件）

- 2026-08-20-01-refactor-page-content-pipeline.md (PageContentPipeline深いモジュールを新設 — 10モジュール3,600行を prepare() の1 seam に集約。extractor.ts を委譲に簡素化。interface テスト6件追加。86e0786c)
- 2026-08-20-02-refactor-recording-pipeline-steps.md (RecordingPipeline 8フラグ組み合わせの深いインターフェーステストを追加 — force/skipDuplicateCheck/previewOnly の相互作用を record() の1 seam で検証。BEST_EFFORT/Mutex も同 seam で検証。a10b2a34)
- 2026-08-20-03-refactor-sqlite-domain-repository.md (BrowsingLogRepository深いモジュールを新設 — 20 thin proxy を6 domain メソッドに集約。token/timeout/retry を1 seamに隠蔽。6a05d936)
- 2026-08-20-04-refactor-diagnostics-panel-deepening.md (DiagnosticsCollector深いモジュールを新設 — 681行 god module の11診断を collect() → Snapshot に集約。local-substitutable adapter でテスト。e06fa484)
- 2026-08-20-05-refactor-settings-repository-unification.md (SettingsRepository深いモジュールを新設 — 30+散在の StorageKeys アクセスを typed get/set に集約。InMemory adapter でテスト。e06fa484)
- 2026-08-20-00-backlog.md (第2波5件のRICEスコアリングバックログ — Reach/Impact/Confidence/Effort + 依存図 + なぜなぜ分析)

### 2026-08-20 アーキテクチャ深深化第2波 前波アーカイブ（5件）

- 2026-08-20-01-refactor-saved-url-repository.md (SavedUrlRepository統合。前波で実装 — savedUrlStore 552行の5責務を崩壊、c39ad7b4でマージ)
- 2026-08-20-02-refactor-dashboard-sqlite-proxy-collapse.md (dashboardSqliteService 20関数をcallDashboardに集約。前波で実装)
- 2026-08-20-03-refactor-panel-lifecycle-interface.md (25パネルのPanelLifecycle定義。前波で実装)
- 2026-08-20-04-refactor-handler-composition-collapse.md (3層handler配線を統合、Pick型で最小依存注入。前波で実装)
- 2026-08-20-05-refactor-settings-schema-binding.md (SettingsSchema定義。前波で実装)
- 2026-08-20-00-backlog.md (前波5件のRICEスコアリングバックログ) — 注: 同名ファイルのため archived 側は前波版、pbi/ 側は第2波版が現行

### 2026-08-19 アーキテクチャ深深化でアーカイブ済み（5件）

- 2026-08-19-01-refactor-split-settings-god-module.md (settingsStore.tsをurlWhitelist/settingsMigration/storageMaintenanceに分割し循環依存を解消。133行)
- 2026-08-19-02-refactor-collapse-metadata-mappers.md (RecordingContextFieldMapper新設、saveMetadataStep.tsを186行→98行に縮小)
- 2026-08-19-03-refactor-delete-recordingcache-facade.md (静的RecordingCacheクラスを削除し全呼び出し元をRecordingCacheInstance DIに統一)
- 2026-08-19-04-refactor-narrow-handler-deps.md (MessageHandlerRegistryDepsをCommonHandlerDeps/RecordingHandlerDeps等にサブインターフェース分割)
- 2026-08-19-05-refactor-unify-dashboard-sqlite.md (SqliteRpcClientインターフェース導入、categorizeErrorを共有エラー分類に統一)

### 2026-08-19 コードレビュー指摘対応でアーカイブ済み（10件）

- 2026-08-19-00-backlog.md (コードレビュー指摘5件の順位付けバックログ)
- 2026-08-19-01-fix-localhost-port-validation.md (isLocalhostAddressがport未指定時にtrueを返すよう修正済み)
- 2026-08-19-02-fix-prompt-safecontext.md (isInSafeContextの常時falseバグを修正、safeMarkersロジックを実装済み)
- 2026-08-19-03-fix-dashboard-sqlite-types.md (DashboardSqliteMessageのpayloadをDashboardSqliteRequest共用体型に置換済み)
- 2026-08-19-04-fix-encrypt-base64.md (encrypt()の危険なbtoaを安全なbytesToBase64に置換済み)
- 2026-08-19-05-fix-visit-rate-limiter.md (TTLベースのエビクションを追加済み)
- 2026-08-19-06-fix-visit-rate-limiter-ttl-sweep.md (TTLスイープを毎回実行しMAX_ENTRIESは安全弁に留める)
- 2026-08-19-07-fix-prompt-safecontext-bypass.md (HTML属性値内を安全とみなさないようにsafe-context判定を強化)
- 2026-08-19-08-fix-malicious-usage-dangerlevel-ignored.md (LOW危険度検知を4箇所の呼び出し元で構造化ログに記録)
- 2026-08-19-09-improve-pbi-dod-enforcement.md (PBI DoDのテスト存在確認をCIで自動検証)

### 2026-08-18 型安全性強化でアーカイブ済み（6件）

- 2026-08-18-06-refactor-optional-property-strictness.md (`exactOptionalPropertyTypes`/`noImplicitReturns` を tsconfig.json に追加、発生エラー93件を53ファイルで全件解消)
- 2026-08-18-01-fix-eslint-errors-and-wire-ci-lint.md (npm run lint がエラー0件。validateスクリプトにlint追加、CIにLintステップ追加済み。既に完了していたため即時アーカイブ)
- 2026-08-18-02-fix-ban-explicit-any.md (eslint.config.js に no-explicit-any: error 追加。本番コードの any 9件を具象型に置換。MessageHandler の message: any は WHY コメント付きで維持)
- 2026-08-18-04-fix-remove-unknown-casts.md (as unknown as 31件を棚卸し。11件を型安全に置換、残り20件に WHY コメント付与。staticPanelAdapter/sourceManager の型設計見直し)
- 2026-08-18-05-refactor-disable-allow-js.md (bloomfilter-vendor.d.mts 作成、@ts-ignore 削除、allowJs: false に変更)
- 2026-08-18-03-refactor-tsconfig-strict-flags.md (tsconfig.json に noUncheckedIndexedAccess/noImplicitOverride/noFallthroughCasesInSwitch 追加。187件の型エラーを53ファイルで全件解消。CIとエディタの型チェックを整合)

### 2026-08-17 着手状況調査でアーカイブ済み（13件）

コードを直接調査し、受け入れ基準充足を確認できたもののみアーカイブ。部分実装のものはINDEX表に🔶注記付きで残置。

- 2026-08-17-02-refactor-unify-content-extraction-pipeline.md (buildExtractionOptions経由でoptionBuilder.tsに統一済み)
- 2026-08-17-03-refactor-remove-aiclient-wrapper.md (aiClient.ts自体が削除済み、createBackgroundServices.tsが直接AIService生成)
- 2026-08-17-05-refactor-composition-root-service-worker.md (service-worker.ts 214行、責務ごとのファクトリに分割済み)
- 2026-08-17-06-refactor-unify-recording-data.md (RecordingDataをmessaging/types.tsから再エクスポートし単一ソース化)
- 2026-08-17-07-refactor-collapse-recording-context.md (RecordingContextを意味のあるサブグループの交差型に分解済み)
- 2026-08-17-09-refactor-unify-pipeline-step-di.md (StepDepsに単一定義、各ステップがDI経由に移行済み)
- 2026-08-17-10-refactor-extract-result-builder.md (resultBuilder.tsへ抽出しRecordingPipelineから呼び出し済み)
- 2026-08-17-12-refactor-extract-notification-save-obsidian.md (saveToObsidianStepから通知呼び出しを除去、ハンドラ層責務化を明記)
- 2026-08-17-13-refactor-split-sqliteclient-transport.md (OffscreenTransport抽象化・ChromeOffscreenTransport実装に分割済み)
- 2026-08-17-15-refactor-flatten-dashboard-handler-deps.md (ReadOnlyDeps/CoreCrudDeps/MaintenanceBatchDepsに分離済み)
- 2026-08-17-20-refactor-unify-error-classification.md (errorClassification.tsに統一、errorMessages.tsは委譲shim化)
- 2026-08-17-21-refactor-unify-sensitive-data-masking.md (sensitiveDataMask.tsに統一、logMasker.ts等が委譲)
- 2026-08-17-22-refactor-collapse-masterpassword-module-state.md (MasterPasswordControllerクラスへ状態をインスタンス化済み)

### 2026-08-17 /feature-devでアーカイブ済み

- 2026-08-17-08-refactor-merge-recording-logic.md (RecordingPipelineにrecord()/recordWithPreview()を追加しRecordingLogicクラスを削除。createBackgroundServices.tsおよび呼び出し元5ファイルをRecordingPipeline直接参照に統一、テスト14ファイルを整理・移行。npm test 7979件成功)
- 2026-08-17-01-refactor-split-sqlite-engine-context.md (分割先4モジュールが孤立コードだった状態を修正し、sqliteEngineContext.tsが実際に委譲する構造へ。698行→283行、各モジュール250行以内。単体テスト22件追加、npm test 8065件成功)
- 2026-08-17-00-epic-architecture-deepening-aug17.md (子PBI 01〜05が全て完了したため親エピックも完了)
- 2026-08-17-28-fix-extractor-false-purity-pagestate.md (extractPageContentを純粋関数化しExtractResultオブジェクトを返す形に変更。pageState反映はreportValidVisit/GET_CONTENTハンドラ側の責務に分離。既存テスト4ファイルのアサーションを新契約に追従、純粋性検証テスト3件追加。npm test 8068件成功)
- 2026-08-17-23-refactor-deepen-cspsettings-static-facade.md (@deprecated CSPSettings静的クラスを削除しCspSettingsControllerインスタンス(cspSettings)に一本化。escapeRegExpをutils/string.tsへ移動、重複i18nヘルパーをutils/i18n.tsのgetMessageに統一。window.alertをインラインメッセージ表示に置換。既存テスト6ファイル更新、npm test 8065件成功)
- 2026-08-17-39-refactor-collapse-dashboard-sqlite-boilerplate.md (callDashboard<Req,Res>汎用ヘルパーを新設し、同一パターンの14関数を1呼び出しwrapperに置換。リトライ処理・非ServiceResult形状・専用デコードが必要な5関数は対象外として明示。704行→650行、npm test 8066件成功)
- 2026-08-17-00-backlog-architecture-deepening-batch3.md (対象6候補35〜40が全てアーカイブ済みとなったため索引文書もアーカイブ)
- 2026-08-17-26-refactor-decompose-recordcurrentpage-god.md (615行を TabContentFetcher/PreviewFlow/ForceRecordFlow/SpinnerManager/ErrorPresenter/RecordOrchestrator の6クラスに分解。uiStateをRecordOrchestratorのインスタンスフィールド化。ファサード32行、新規テスト14件追加、npm test 8080件成功)
- 2026-08-17-24-refactor-extract-sqlitehistorypanel-closure.md (875行から純粋HTML構築関数をsqliteHistoryPanelView.tsへ抽出、イベント配線はパネル側に残置。chrome.notificationsを新設notificationService.tsへ移動。パネル586行/View358行、新規テスト37件追加、npm test 8115件成功)
- 2026-08-17-27-refactor-decompose-trustdb-god-module.md (820行をDomainVerifier/BloomFilterManager/TrancoManager/SensitiveDomainStore/WhitelistStore/TrustDbVersionの6モジュールに分解。オーケストレーター557行に削減。storage/types.jsの動的importを静的化し循環依存を部分解消（settingsStore.jsとの循環はTrancoバージョンのsettings保存設計に起因するため意図的維持、理由をコード内に明記）。単体テスト33件追加、npm test 8148件成功)
- 2026-08-17-19-refactor-instance-session-store-header-detector.md (HeaderDetectorをインスタンス化。initialize/onHeadersReceived/cachePrivacyInfo等をインスタンスメソッド化しcreateBackgroundServices.tsで生成、service-worker.tsのグローバル初期化を除去。normalizeUrlは状態を持たない純粋関数のためstatic維持。npm test 7979件成功)
- 2026-08-17-14-refactor-instance-pending-storage-queue.md (pendingChromeStorageQueueのimport時即時生成シングルトンを廃止、createBackgroundServices経由のsetPendingWriteQueue明示初期化に変更。InMemoryAdapterを新設しテストをchrome.storageモック非依存に。呼び出し元saveMetadataStep/alarmHandlerのDI化は全StepDeps型への横断変更となるため今回はスコープ外と判断しユーザー確認済み。npm test 7979件成功)
- 2026-08-17-18-refactor-logger-dual-module.md (logger/*への直接import違反は実質0件と確認（sqliteAlert.tsのcriticalAlertSink.js importは意図的なDIアダプタ分離のため対象外）。eslint.config.jsにno-restricted-importsルールを追加しlogger/*直接importを禁止、logger.ts自体は除外設定。npm run type-check成功)
- 2026-08-17-35-refactor-split-message-handlers.md (messageHandlers.ts 680行・31エクスポートをrecordingHandlers.ts(8)/testingHandlers.ts(6)/systemHandlers.ts(21)の3モジュールに分割。createMessageHandlerRegistry.tsが3モジュールをimport、createBackgroundServices.tsと関連テスト4ファイルのimport元を更新。npm test 7979件成功)
- 2026-08-17-36-refactor-complete-error-classification-consolidation.md (createErrorResponseをerrorClassification.tsへ移動しsanitizeContextをsensitiveDataMask.maskSensitiveData('full')に置換。3本番importer(messageHandler.ts/systemHandlers.ts/dashboardSqliteWiring.ts)の参照先を更新、errorMessages.tsを45行の@deprecated再エクスポートshimに縮小。関連テスト396件成功)
- 2026-08-17-37-refactor-unify-opfs-where-query-builder.md (crudHandlers.tsのインラインWHERE/ORDER BY構築をsqliteQueryBuilder.ts経由(buildWhereClause/buildOrderByClause)に置換。crudHandlers固有のFTS5タグMATCH条件はbuildFtsTagMatchCondition新設で対応、既存IdbVfsBackendの挙動に影響しないようbuildWhereClause本体にはtag条件を追加せず呼び出し側で明示合成。ALLOWED_ORDER_COLUMNSをschema.tsに一本化。契約テスト10件新規追加。npm test 7989件成功)
- 2026-08-17-04-refactor-inject-store-recording-cache.md (RecordingCacheをRecordingCacheInstance(store注入可能)へ全面インスタンス化。RecordingCacheStore/SessionStoreRecordingCacheStore/InMemoryRecordingCacheStoreを新設。既存static呼び出し元14箇所はdefaultRecordingCacheへ委譲するstatic facadeとして無変更のまま動作、createBackgroundServices側も一貫性維持のためdefaultRecordingCache経由を継続（新規RecordingCacheInstance生成によるキャッシュ分断を回避）。独立性検証テスト5件新規追加。ユーザー確認の上フルインスタンス化を選択。npm test 7994件成功)
- 2026-08-17-16-refactor-inject-url-store-check-duplicate.md (StepDepsにUrlStoreインターフェースを追加しcheckDuplicateStepがdeps.urlStoreを優先利用する形に変更。RecordingPipelineがexecuteInternal内で常にurlStoreを渡すため実運用経路ではgetSavedUrlsWithTimestamps直接呼び出しは発生しない。InMemoryUrlStoreによるテスト3件新規追加。npm test 7997件成功)
- 2026-08-17-17-refactor-di-ify-offline-network-queue.md (buildRecordingPipelineDepsからsharedOfflineNetworkQueueの直接importを除去しPickパラメータとして受け取る形に変更。呼び出し元createBackgroundServices.tsが明示的に注入。NoOpOfflineNetworkQueueを新設しテスト2件追加。npm test 7999件成功)
- 2026-08-17-11-refactor-remove-notifications-from-pipeline.md (resultBuilder.tsのbuildErrorResultからchrome.notifications.create呼び出しを除去し、notifyRecordingErrorという独立関数に分離。既存のnotifyObsidianSaveSuccess(成功時通知)パターンと統一し、RecordingPipeline.executeInternalが明示的に呼ぶ形に。buildErrorResultはglobalThis.chrome未設定でも動作することをテストで確認。npm test 8006件成功)
- 2026-08-17-40-refactor-extract-managed-string-list-trustdb.md (trustDb.ts 889行のCRUD重複8メソッドをManagedStringListクラス(add/remove/getAll)に集約し3インスタンス化(userTlds/sensitiveDomains/whitelist)。Trancoバージョン追跡5メソッドをTrancoVersionTrackerに分離。「未初期化時エラー」の既存テスト5件が失敗したため各委譲メソッドにstate.databaseの二重ガードを追加して対応。ManagedStringList/TrancoVersionTracker単体テスト17件新規追加。PBI-27(6モジュール分解＋循環依存解消)はユーザー確認の上、規模超過につき見送り。npm test 8023件成功)
- 2026-08-17-38-refactor-extract-ssrf-ip-policy.md (fetch.ts 562行からSSRF/IPポリシー(isPrivateIpAddress/isLocalhostAddress/normalizeIpHostname/validateUrl*/ALLOWED_LOCALHOST_PORTS)をssrfGuard.tsへ分離。fetch.tsは再エクスポートで既存呼び出し元3ファイル(recordingValidator.ts/OpenAIProvider.ts/GeminiProvider.ts)を無変更に維持。cspValidator.tsの重複ALLOWED_LOCALHOST_PORTS定義をssrfGuard.tsからのimportに統一。ssrfGuard単体テスト23件新規追加(fetchモック不要)。npm test 8046件成功)
- 2026-08-17-25-refactor-eliminate-loader-urlskipper-copy.md (「content_scriptsは静的importできない」というPBI本文の前提を実ビルド(WXT/rolldown)で検証したところ、バンドラーがインライン化するため実際には制約が存在しないことが判明。loader.tsからSKIPPED_PROTOCOLS等74行の重複コードを削除しurlSkipper.tsを静的importする形に変更。urlSkipper-contract.test.ts(コピー同期契約テスト)を削除し、loader-no-static-imports.test.tsを「バンドラーで解決可能な相対importのみ許容」+「urlSkipper.tsをimportしていること」を検証する形に更新。wxt-build.test.tsにビルド成果物(content.js)にimport文が残らないことを検証するテストを追加。npm test 8043件成功)

### 2026-08-15 アーカイブ済み

- 2026-08-15-01-feat-history-sort-dropdown.md (SQLite Historyパネルにソートドロップダウンを追加。検索3バックエンド（IdbVfs/OPFS Worker/Fallback）全てにORDER BY分岐、選択はchrome.storage.localに永続化。v6.7.46 としてリリース)

### 2026-08-13 アーカイブ済み

- 2026-08-13-01-fix-encryption-session-mutex.md (getOrCreateEncryptionKeyのsession→local復元をMutexで排他制御、ダブルチェックロッキングで二重の新規secret生成を防止。実装中にMutex.ts自体の潜在バグ（診断ログ失敗によるロック永久化）を発見し併せて修正)
- 2026-08-13-02-fix-log-critical-sanitize-notification.md (logCriticalのOS通知にsanitizeRegex適用、PII/APIキー漏洩を防止)
- 2026-08-13-05-fix-apply-metadata-patch-runtime-guard.md (applyMetadataPatchにurl/timestamp実行時ガードを追加、型キャスト経由の改ざんを防止)
- 2026-08-13-03-fix-pending-queue-tags-unbounded-growth.md (pendingChromeStorageQueueのマージ後サイズ検証を拡張、content間引き後もtags肥大化する場合は末尾優先で切り詰め)
- 2026-08-13-04-fix-logger-flush-alarm-not-cleared.md (LogFlushSchedulerにclear()追加、persistPending成功時とclearLogsでスケジュール済みアラームを解除)

### 2026-08-11 アーキテクチャ深深化Epicでアーカイブ済み（11件）

- 2026-08-11-01-refactor-architecture-deepening-epic.md (5候補と子PBIを依存順に実装。atomic Saved URL保存、unified history query、panel state seam、handler依存縮小、review summaryのAIService移行を完了)
- 2026-08-11-02-deepen-saved-url-entry-module.md (Saved URL metadataのatomic CAS、metadata patch retry、旧queue payload互換)
- 2026-08-11-03-unify-history-query-module.md (SQLite history panelのquery/enrichment統合、最新row限定enrichment)
- 2026-08-11-04-deepen-sqlite-history-panel-test-seams.md (DOM非依存state seam、request generation guard、stale response防止)
- 2026-08-11-05-unify-recording-handler-interface.md (handler最小依存、共有closure、composition wiring整理)
- 2026-08-11-06-migrate-review-summary-to-ai-service.md (AIService factory注入、alarm/message共有、AIClient直接生成除去)
- 2026-08-10-01-refactor-dashboard-sqlite-result-contract.md (Epicへ統合し、SQLite結果契約とDashboard失敗処理を実装)
- 2026-08-10-02-refactor-sqlite-client-result-surface.md (Epicへ統合し、重複結果surfaceを整理)
- 2026-08-10-03-refactor-background-composition-wiring.md (Epicへ統合し、production compositionとrecording依存を整理)
- 2026-08-10-04-refactor-sqlite-offscreen-response-protocol.md (Epicへ統合し、SQLite response protocolを実装)
- 2026-08-10-05-refactor-recording-offline-policy.md (Epicへ統合し、offline policy metadataを実装)

### 2026-08-11 セッションでアーカイブ済み（3件）

- 2026-08-11-02-refactor-handler-registry-composition-root.md (handler registryをcomposition rootへ移設し、全19件のtrust levelを契約テストで固定)
- 2026-08-11-03-test-offline-retry-contract.md (obsidian_sync retryのmaskedCount不使用、SQLite/metadata step非再実行を契約テストで固定)
- 2026-08-11-04-refactor-dashboard-opfs-migration-decoder.md (DashboardのopfsMigrationV2*フィールドに厳密decoderを適用)

### 2026-08-12 セッションでアーカイブ済み（5件）

- 2026-08-01-17-fix-encryption-key-session-storage.md (マスターパスワード未設定時の暗号化キーをchrome.storage.sessionへ移行。マイグレーション・local storageフォールバック・PRIVACY.md更新を完了)
- 2026-08-07-08-refactor-ai-client-service-unification.md (AIClientをRemoteAIServiceの薄い委譲ラッパー化。in-flight重複排除・factory reuseを実装。AIClient自体の削除は高リスクのため保留)
- 2026-08-11-07-fix-sqlite-history-panel-reducer-consistency.md (sqliteHistoryPanelの全state mutationをhistoryStateReducer経由に統一)
- 2026-08-11-08-fix-metadata-patch-queue-capacity.md (metadata patch coalescing・payload上限100KB・content省略・RetryableItem対応を完了)
- 2026-08-11-09-fix-history-fallback-failure-contract.md (fallback検索失敗時にServiceErrorを返しover-fetchを解消)

### 2026-08-12 セッションでアーカイブ済み（Logger/Error層深耕 — 6件）

- 2026-08-12-01-refactor-move-message-handler-registry-to-composition-root.md (handler registryをcomposition rootへ移設し、service-worker.tsの責務を削減。createMessageRegistryCompositionを新設)
- 2026-08-12-02-refactor-migrate-aiclient-tests-to-aiservice.md (aiClient.test.tsとaiClient-priority-fallback.test.tsの実質テストをRemoteAIService.test.tsに移行。aiClient.test.tsは委譲contractに縮小)
- 2026-08-12-03-feat-dashboard-multitab-ai-test-correlation.md (AIテスト進捗に相関IDを付与し、複数ダッシュボードタブの干渉を防止)
- 2026-08-12-04-refactor-logger-core-concern-separation.md (Logger core を LogBuffer/LogSanitize/LogStorageAdapter/LogFlushScheduler に分割。core.tsはオーケストレータ化)
- 2026-08-12-05-refactor-logcritical-notification-seam.md (logCriticalから通知責務をCriticalAlertSinkアダプタに分離。sqliteAlert.tsも明示的にsinkを渡す)
- 2026-08-12-06-refactor-resolvelogsource-stack-removal.md (resolveLogSourceのnew Error().stackパースを削除し、sourceを明示渡しのみに)
- 2026-08-12-07-refactor-errorMessage-retain-as-is.md (errorMessage()を削除テストで現状維持と確定。rationaleコメントを追加)

### 2026-08-09 セッションでアーカイブ済み（17件）

アーキテクチャレビュー2026-08-08・2026-08-09の指摘対応。いずれもコード上で完了を確認済み。

- 2026-08-08-01-refactor-recording-logic-split.md (RecordingLogic 541行を RecordingCache/RecordingValidator/RecordingLogic に分割)
- 2026-08-08-02-refactor-ai-service-test-connection.md (AIServiceにtestConnectionを追加。RemoteAIServiceのsuccess/error欠落バグも修正)
- 2026-08-08-03-refactor-panel-contract-cleanup.md (refresh()をoptional化。14実装中8件は実処理を持つため削除は誤りと判明)
- 2026-08-08-04-refactor-messaging-layer-consolidation.md (整合性テストの手書きリストをソース導出方式へ)
- 2026-08-08-05-refactor-ai-provider-asymmetry.md (Geminiの429リトライ・使用量0記録・BuiltInAiのsanitizeContent未通過を解消)
- 2026-08-08-06-test-untested-modules-coverage.md (recordingCache・VULN-014/004にテスト31件追加)
- 2026-08-08-07-fix-sqlite-history-pagination.md (**実害修正**: 履歴1000件超の51ページ目以降が閲覧不能。サーバ側ページングへ)
- 2026-08-08-08-refactor-dead-code-and-seam-bypass.md (死蔵判定を3点とも訂正。i18nは非等価のためseam補強)
- 2026-08-09-10-fix-dashboard-sqlite-lasterror-snapshot.md (**実害修正**: deps.lastErrorが起動時nullで凍結され15箇所のエラー文言が未表示だった問題をgetter化で解消)
- 2026-08-09-11-refactor-dashboard-sqlite-dual-wiring.md (createSqliteClientDepsで本番/テストの配線を共有化)
- 2026-08-09-12-fix-querylogs-error-swallowing.md (**実害修正**: DB障害時に空ファイルをDLし「completed」表示していた問題)
- 2026-08-09-13-refactor-sender-trust-policy.md (registryに信頼レベルを必須化。無防備だったハンドラを強化)
- 2026-08-09-14-refactor-remove-offscreen-sqlite-shim.md (非推奨再エクスポート層を削除。offscreenテストが152→175件に)
- 2026-08-09-15-investigate-markdown-sanitizer-divergence.md (調査完了・**対応不要**。ADRが用途別使い分けを定めており現状が正しい)
- 2026-08-09-16-refactor-remove-dashboard-sqlite-test-wrapper.md (本番未使用のテスト専用wrapperを削除し72箇所をハーネス経由へ)
- 2026-08-09-17-refactor-remove-per-handler-sender-guards.md (認可判定を1箇所に集約。削除前に全19型×3送信元の網羅テスト59件を用意)
- 2026-08-09-18-refactor-cleansing-rule-table.md (**実害修正**: 32ルール中15件がcount経路で捨てられていた問題。既定設定で表示件数 4→6 に是正。countTargets.ts 497行を削除)
- 2026-08-09-19-refactor-sqlite-read-result-union.md (**実害修正**: DB障害が「データがありません」と表示される問題。読み取り系4関数をCallResult貫通に)

### 2026-08-09〜10 セッションでアーカイブ済み（5件）

- 2026-08-09-20-refactor-cleansing-rule-single-source.md (ルール宣言が10層に散在し既定値が7ルール食い違っていた問題。「新規ユーザー既定値」と「未指定時フォールバック」を分離しCLEANSING_RULES表から導出。実装中にenhancedHidden/emptyElemの追加の食い違いを発見・是正。実装計画は3箇所想定だったが実際は5箇所[aiSummaryCleansingSettingsV2.ts]。テスト7680→7690)
- 2026-08-09-21-refactor-sqlite-write-result-union.md (**実害修正**: 削除・スター操作の失敗時に画面が完全無反応だった問題。変更系9メソッドをCallResult化し共有可変lastErrorを完全削除。実装中に「toggle_starの成功レスポンスがsuccessを欠きスター操作が成功時も失敗扱いだった」実害を追加発見・是正。テスト7690→7697)
- 2026-08-09-22-refactor-shallow-static-form-panels.md (init関数を転送するだけの9ファイル133行を宣言表+アダプタへ集約。staticForm/が12→5ファイルに。id検証テストは変異テストで有効性確認済み。**DoDの手動確認[9タブをChromeで開く]は実装者環境で未実施**。テスト7697→7711)

- 2026-08-09-24-refactor-dashboard-reverse-dependency.md (panel層→dashboard.tsの逆依存と二重bootstrapを解消。dashboard.ts 1000行超→93行。借り手が1人しかいない関数を共有モジュールに置く形をやめ、generalSettings/connectionTests.ts・settingsForm.ts と panel 側へ再配置。**計画のRed前提は誤りだった**: testDir/vitest.setup.ts が chrome を全体モックするため「import すると初期化が落ちる」は起きず、import グラフをソース文字列で検証する形に書き換えた。ディープリンクは start() へ渡す形になり click 合成フォールバックが不要に。テスト7711→7727)
- 2026-08-08-09-refactor-dashboard-dual-bootstrap.md (Phase1/3は先行セッションで完了、残る Phase2/4 を 2026-08-09-24 が実施したため完了扱い)

### 2026-08-10 セッションでアーカイブ済み（2件）

- 2026-08-07-13-refactor-service-wiring-backend-consolidation.md (サービス配線・StorageBackend・プロバイダ設定表示・エラー処理の統合候補。調査結果「実重複でない/高リスク」と判断し対応不要でクローズ)
- 2026-08-09-23-refactor-sqlite-transport-layers.md (**Epic 8pt・全Phase完了**)。Phase1(型二重化解消)・Phase2(失敗表現のServiceResult統一)・Phase3(confirmToken要否の単一ソース化)を実施。Phase3 はシニア相談を経て `tokenExempt` 免除リスト方式（fail-safe）で実装。旧実装でトークン不要だった破壊的操作3件（append_to_obsidian/purge_now/content_purge_now）を要トークン化。トークン要否を `messaging/sqliteOperationSecurity.ts` に一元化し送受信ドリフトを排除。**このセッションでアーカイブした実装計画**: `2026-08-09-pbi23-sqlite-transport-layers-plan.md` / `2026-08-09-pbi23-phase3-senior-consultation.md`

**同セッションでアーカイブした実装計画（dev-docs/archived/plans/）10件**:
2026-07-27-pbi11 / pbi13 / pbi15 / pbi24 / pbi26 / pbi27 / pbi29-36-35 / pbi34 の各計画と
2026-07-26-chrome-built-in-ai-provider-plan.md。いずれも対応PBIがアーカイブ済み。

---

### 2026-08-07 セッションでアーカイブ済み

**実装済みPBI（dev-docs/archived/pbi/）** — 重複コード解消:
- 2026-08-07-01-refactor-ai-provider-common-extraction.md (Gemini/OpenAIプロバイダ重複をAIProviderStrategy基底クラスへ抽出)
- 2026-08-07-02-refactor-master-password-ui-unification.md (マスターパスワードUIのpopup/dashboard統合)
- 2026-08-07-03-refactor-settings-export-import-ui-unification.md (設定エクスポート/インポートUI統合)
- 2026-08-07-04-refactor-utility-functions-consolidation.md (escapeHtml/base64/showStatus等の共通化)
- 2026-08-07-05-refactor-domain-matching-consolidation.md (ドメインマッチング/wildcardToRegex統合)
- 2026-08-07-06-refactor-legacy-url-storage-removal.md (urlStorageをsavedUrlStoreへ統合・削除)
- 2026-08-07-07-refactor-allowed-urls-single-source.md (許可URL二重実装の単一ソース化・Obsidianポート27124バグ修正)
- 2026-08-07-09-refactor-pending-queue-unification.md (保留キュー3実装をStorageBackedQueueへ共通化)
- 2026-08-07-10-refactor-provider-labels-single-source.md (PROVIDER_LABELSをaiProviderLabels.tsへ単一ソース化)
- 2026-08-07-11-refactor-sqlite-extract-domain-consolidation.md (sqliteEngineContextのextractDomainをwww除去に統一)
- 2026-08-07-12-refactor-duplicate-test-consolidation.md (Gemini/OpenAI/fieldValidationの重複テスト統合)

**実装計画（dev-docs/archived/plans/）**:
- 2026-08-07-01〜06 の各実装計画（ai-provider-common-extraction / master-password-ui-unification / settings-export-import-ui-unification / utility-functions-consolidation / domain-matching-consolidation / legacy-url-storage-removal）

### 2026-08-02 セッションでアーカイブ済み

- 2026-08-02-01-feat-expand-prompt-injection-tests.md (プロンプトインジェクション検知テスト拡充。OWASP/日本語含むインジェクションマトリクスと誤検知ガードを `promptSanitizer-owasp-matrix.test.ts` に追加。npm run validate成功)
- 2026-08-02-02-feat-optimistic-lock-stress-test.md (楽観的ロックのストレステスト。大量順序バッチ・キー間独立性・リトライ枯渇時のConflictError・冪等更新の収束を `optimisticLock-stress.test.ts` に追加。npm run validate成功)
- 2026-08-02-03-feat-privacy-pipeline-integration-test.md (プライバシーパイプラインのPIIリーク防止検証。クラウドAI送信データに生PIIが含まれないことを成功/ローカル失敗/マスク済みクラウドの各モードで `privacyPipeline-pii-leak.test.ts` に追加。npm run validate成功)
- 2026-08-02-04-fix-obsidian-api-key-leakage-prevention.md (Obsidian APIキー漏洩防止のクライアントレベル検証。ヘッダーへの正当な配置と、ログへの生キー非出力を `obsidianClient-api-key-leak.test.ts` に追加。npm run validate成功)
- 2026-08-02-05-fix-sqlite-unique-constraint-validation.md (SQLiteの(url, created_at) unique制約検証。重複INSERTが静かに無視され、同一URL別タイムスタンプが保持されることを `recordsRepo-unique-constraint.test.ts` に追加。npm run validate成功)

### 2026-08-02 セッションでアーカイブ済み（機能追加分）

- 2026-08-02-01-feat-builtin-ai-diagnostics.md (診断パネルにブラウザ内蔵AI診断セクションを追加。builtInAiDiagnosticsService + diagnosticsPanelに診断表示・モデルダウンロード導線を実装。npm run validate成功)

### 2026-08-01 セッションでアーカイブ済み

- 2026-08-01-22-fix-tranco-domains-clear-cost-documentation.md (saveOldTrancoDomains/clearOldTrancoDomainsのJSDocにsaveSettings()経由のコスト特性を明記。ロジック変更なし)
- 2026-08-01-21-fix-offline-queue-test-pending-promise-cleanup.md (persists retryCount progressテストの未解決Promiseを明示的にresolve/awaitしてクリーンアップする形に変更)
- 2026-08-01-20-fix-trustdb-dynamic-import-duplication.md (trustDb.tsの3箇所の重複する動的importをgetSettingsStore/getStorageTypesヘルパーに集約)
- 2026-08-01-19-fix-offline-queue-save-frequency.md (saveQueue書き込みコスト・頻度を調査。unlimitedStorage権限によりクォータ制限なし、耐障害性とのトレードオフを優先し対応不要と判断してクローズ)
- 2026-08-01-18-fix-offline-queue-pending-filter-complexity.md (retryAll()のpending配列除去をfilter(O(n²))からshift()(O(n))に改善)
- 2026-08-01-16-fix-trustdb-settings-store-unification.md (trustDb/trancoConsentManagerのtranco_domains・tranco_versionをgetSettings/saveSettings経由に統一。npm run validate成功)
- 2026-08-01-15-fix-offline-queue-rate-limit.md (retryAll()にMAX_JOBS_PER_CYCLE=20を追加、上限超過分は次回サイクルへ持ち越し。npm run validate成功)
- 2026-08-01-14-fix-offline-queue-alarm-await.md (alarmsリスナーをasync化しPromise.allSettledで並列待機、retryAll()をジョブ単位保存に変更。npm run validate成功)
- 2026-08-01-13-fix-url-fallback-triggered-optimistic-lock.md (setUrlFallbackTriggeredをwithOptimisticLockに統一、URL照合を他setterと同じ非正規化方式に変更。npm run validate成功)
- 2026-08-01-01-fix-service-worker-init.md (Service Worker の init() 呼び出し。遅延マイグレーションで E2E 競合を回避。v6.7.7 としてリリース)
- 2026-08-01-02-fix-crypto-envelope-validation.md (暗号化エンベロープ入力検証強化。v6.7.7 としてリリース)
- 2026-08-01-03-fix-hmac-key-protection.md (HMAC 署名鍵暗号化保存。v6.7.7 としてリリース)
- 2026-08-01-04-fix-prompt-injection-defense.md (プロンプトインジェクション対策強化。v6.7.7 としてリリース)
- 2026-08-01-05-fix-content-script-sender-validation.md (VALID_VISIT sender 検証 + レート制限。v6.7.7 としてリリース)
- 2026-08-01-06-fix-pii-long-token-leak.md (PII long-token マスク漏れ修正。v6.7.7 としてリリース)
- 2026-08-01-07-fix-non-idempotent-retry.md (POST 5xx 再送禁止。v6.7.7 としてリリース)
- 2026-08-01-08-fix-recording-state-resource-management.md (Mutex/Cache/SessionStore リソース管理。v6.7.7 としてリリース)
- 2026-08-01-09-fix-fetch-utility-robustness.md (fetch timeoutMs/AbortError/IPv6/localhost。v6.7.7 としてリリース)
- 2026-08-01-10-fix-crypto-maintainability.md (暗号化モジュール保守性。v6.7.7 としてリリース)
- 2026-08-01-11-fix-obsidian-client-robustness.md (Obsidian クライアント堅牢性。v6.7.7 としてリリース)
- 2026-08-01-12-fix-ai-provider-consistency.md (AI プロバイダー整合性。v6.7.7 としてリリース)

### 2026-07-30 セッションでアーカイブ済み

- 2026-07-30-38-feat-edge-phi-mini-provider-support.md (Edge (Phi-mini) Built-in AI 対応。実機検証でAPI形状がChromeと同一と判明し、既存 `BuiltInAIClient` に動的コンテキスト切り詰め・`oncontextoverflow`監視・ブラウザ別案内文言を追加。i18n・テスト実装済み。`browserSupport.ts` のデッドコード `supportsBuiltInAI()` を削除。v6.7.4 としてリリース)

### 2026-07-28 セッションでアーカイブ済み

- 2026-07-26-32-feat-built-in-ai-provider-implementation.md (TDDによるBuilt-in AI Provider実装。`BuiltInAIClient`（Service Workerから`LanguageModel`を直接呼び出す実装）をTDDで構築し`LocalAIService`/`FallbackAIService`に統合、`offscreen.ts`をSQLite専用に純化、旧`localAiClient.ts`を削除。優先度リストの`built-in-ai`スロット判定を`AIClient`に実装しフォールバックが動作することを単体テストで検証。ダッシュボードUIに選択肢を追加しi18n対応。実機Service Workerで`LanguageModel.create()`→`session.prompt()`の成功を確認、Playwrightで`@interaction`E2Eテスト化（`dashboard-built-in-ai.spec.ts`、`playwright.config.ts`に`interaction`プロジェクト新設）。オフライン動作確認の受け入れ基準はGemini Nanoがオンデバイス推論で外部通信を行わないため検証行為自体が成立しないと判断し撤回、コードレビューで外部通信呼び出し不在を確認する形に代替。全7272テスト・型チェック・ビルド成功)
- 2026-07-26-31-feat-built-in-ai-provider-integration-design.md (Built-in AI Provider統合設計。PBI本文が想定していた`AIProviderStrategy`/`AIClient.registerProvider`経由ではなく、2026-07-27 ADR「AIClientとAIServiceの統一方針」に沿って`AIService`経由で統合する設計に転換。Service Worker直接呼び出し・長文前処理・状態別UX・ダッシュボードUI統合を `dev-docs/2026-07-28-built-in-ai-provider-integration-design.md` に設計、チームレビュー承認済み)
- 2026-07-26-30-feat-chrome-built-in-ai-oss-research.md (Chrome Built-in AI OSS実装3件・Prompt API公式仕様を調査し `dev-docs/2026-07-27-chrome-built-in-ai-oss-research.md` にレポート化。実機検証によりService Worker内で`LanguageModel`へ直接アクセス・呼び出しできることを確認、既存の「Offscreen Document必須」という前提に疑義を提示。改善候補6件をPBI-31に引き継ぎ)

### 2026-07-27 セッションでアーカイブ済み

- 2026-07-25-11-fix-verify-constant-time-compare.md (constantTimeCompareフォールバック実装の定数時間性を検証。ベンチマークスクリプト作成・Playwright 可用性チェック・ADR 記録・実 Chrome ブラウザでのタイミング計測完了。有意差あり(t=2.2381)を確認。追加緩和策は不要と判断しPBI-33をクローズ)
- 2026-07-27-33-fix-constant-time-compare-mitigation.md (constantTimeCompareフォールバックのタイミングサイドチャネル緩和。なぜなぜ分析の結果、追加緩和策は不要と判断。ローカルのパスワード検証のみでネットワークに露出しないため、1.85μsのタイミング差は攻撃面に影響しない)
- 2026-07-26-27-fix-popup-dashboard-settings-duplication.md (popup の重複設定 UI を削除し dashboard に一本化。共有モジュールはファイル削除せず popup 側の init 呼び出しのみ除去。自動テスト・ビルド検証済み)
- 2026-07-25-35-fix-service-worker-state-persistence.md (`isCacheInitialized`/`autoSavedBadgeTabs` を `chrome.storage.session` へ永続化、実ブラウザ動作確認済み)
- 2026-07-25-36-refactor-service-worker-singleton-di.md (`TabCache` の遅延初期化パターン試験導入、実ブラウザ動作確認済み)
- 2026-07-26-29-refactor-service-worker-god-file-split.md (オフラインキュー処理抽出・未使用 `RecordingPipeline` import 削除、実ブラウザ動作確認済み)
- 2026-07-26-24-refactor-utils-subdirectory-split.md (`crypto.ts`/`typesCrypto.ts` を `src/utils/crypto/` へ移行、Task 1完了としてアーカイブ)
- 2026-07-26-26-refactor-ai-client-service-unification.md (`AIService` への統一方針を ADR に記録、`AIClient` に新規利用非推奨の JSDoc を追加)
- 2026-07-26-13-fix-legacy-dual-write-default.md (`pendingChromeStorageQueue.ts` を新設し chrome.storage 書き込み失敗時のリカバリキューを実装。デフォルト変更は影響範囲が大きいため見送り、ADRに記録)
- 2026-07-26-15-fix-settings-migration-non-destructive.md (`settings` 移行時の個別キー削除を `legacy_settings_backup_*` への退避に変更。破損時の復元ロジックと30日後のクリーンアップを追加)

### 2026-07-26 セッションでアーカイブ済み

- 2026-07-22-01-doc-response-size-limit-adr.md (response-size-limit用ADR作成、後片付け漏れを確認しアーカイブ)
- 2026-07-22-02-refactor-response-size-limit-detection.md (ASTベース検出ロジックへのリファクタ、後片付け漏れを確認しアーカイブ)
- 2026-07-25-01-fix-release-command-injection.md (release.ymlコマンドインジェクション修正、重複ファイルを整理)
- 2026-07-25-02-fix-oauth-response-log-leak.md (OAuthログ漏洩防止、重複ファイルを整理)
- 2026-07-25-03-fix-cws-publish-reliability.md (CWS公開ステップ信頼性向上、重複ファイルを整理)
- 2026-07-25-04-feat-ci-security-review-checklist.md (CI/CDセキュリティレビューチェックリスト作成、重複ファイルを整理)
- 2026-07-25-05-feat-log-sensitivity-policy.md (ログ機密性分類ポリシー策定、重複ファイルを整理)
- 2026-07-25-06-feat-external-api-reliability-guideline.md (外部API信頼性設計ガイドライン策定、重複ファイルを整理)
- 2026-07-25-07-feat-eslint-rule-testing-guideline.md (ESLintルールテストケース生成プロセス確立、重複ファイルを整理)
- 2026-07-25-08-feat-cwe-classification-guideline.md (CWE分類フレームワーク適用ガイドライン、重複ファイルを整理)
- 2026-07-25-09-doc-api-endpoint-documentation.md (Obsidian Local REST APIエンドポイント一覧を文書化)
- 2026-07-25-10-fix-magic-numbers-extraction.md (背景処理のマジックナンバーを名前付き定数に抽出)
- 2026-07-25-12-doc-recording-pipeline-edge-cases.md (RecordingPipelineのステップ実行順序をコメントで図示)
- 2026-07-25-13-fix-verify-inline-event-handler.md (recordBtn等の.onclick=パターンに設計意図のコメント追加)
- 2026-07-25-14-fix-pii-regex-redos-hardening.md (PIIサニタイズのemailパターンによるReDoS解消)
- 2026-07-25-15-fix-hardcoded-japanese-strings.md (popup.html日本語ハードコード修正、13箇所。options.html分はPBI-33に分割)
- 2026-07-25-16-fix-ai-summary-locale-default.md (AI要約デフォルトプロンプトのロケール解決を修正)
- 2026-07-25-17-fix-privacy-consent-integrity-signature.md (プライバシー同意記録にHMAC署名検証を追加)
- 2026-07-25-18-fix-data-retention-after-consent-withdrawal.md (同意撤回時のデータ削除確認ダイアログ追加)
- 2026-07-25-19-fix-migration-retry-limit.md (マイグレーション失敗の無限リトライに上限を追加)
- 2026-07-25-20-fix-logger-batch-flush-strategy.md (ログバッチフラッシュの既存実装状況を記録・SW終了時タイムアウト可視化)
- 2026-07-25-21-fix-ai-call-deduplication.md (AI要約リクエストのin-flight重複排除を実装)
- 2026-07-25-22-fix-duplicate-check-race-condition.md (RecordingPipelineにURL単位のMutexを追加)
- 2026-07-25-23-fix-sqlite-optimistic-lock.md (SQLite楽観的ロックの現状調査、対応不要と判断)
- 2026-07-25-24-fix-focus-trap-consistency.md (フォーカストラップの共通ロジックを抽出し未使用箇所に適用)
- 2026-07-25-25-refactor-background-error-handling.md (共通エラーハンドリングラッパーの導入状況を記録)
- 2026-07-25-26-refactor-legacy-typescript-patterns.md (settingsへの値代入をassignSettingValue()経由に統一)
- 2026-07-25-27-refactor-obsidian-api-abstraction.md (Obsidian Local REST APIのパス組み立てを一元化)
- 2026-07-25-28-fix-message-type-contract-testing.md (メッセージ型契約テストをVALID_MESSAGE_TYPESからSSOT自動導出化)
- 2026-07-25-29-refactor-test-setup-simplification.md (chrome.i18nメッセージモックをen/messages.jsonから動的生成)
- 2026-07-25-30-fix-pbkdf2-legacy-timing-sidechannel.md (PBKDF2レガシー検証パスのタイミングサイドチャネル解消)
- 2026-07-25-31-fix-verify-legacy-crypto-export-removal.md (非推奨hashPassword/verifyPasswordを内部専用化)
- 2026-07-25-32-fix-export-batch-pagination.md (ローカルMarkdown全履歴エクスポートをバッチストリーミング化)
- 2026-07-25-33-refactor-domain-filter-consolidation.md (ドメインフィルタ関連コードの責務分離マップをADRとして作成)
- 2026-07-26-01-doc-privacy-md-sync.md (public/PRIVACY.mdをdocs/PRIVACY.mdの最新内容に同期)
- 2026-07-26-02-doc-design-tokens.md (デザイントークン「研墨」をDESIGN_TOKENS.mdとして文書化)
- 2026-07-26-03-fix-encryption-secret-label.md (ENCRYPTION_SECRETの誤った「廃止予定」ラベルを訂正)
- 2026-07-26-04-fix-wa-sqlite-version-pin.md (wa-sqliteバージョン方針の調査、現状維持でクローズ)
- 2026-07-26-05-feat-ci-sbom-generation.md (CIにSBOM生成ステップを追加)
- 2026-07-26-06-fix-html-lang-attribute-dynamic.md (html lang属性動的化、実装済みと確認しクローズ)
- 2026-07-26-07-fix-addlog-message-sanitization.md (addLogのmessageパラメータもPIIサニタイズ対象に追加)
- 2026-07-26-08-fix-offscreen-ai-error-exposure.md (offscreen.tsの生エラーオブジェクトのconsole出力を修正)
- 2026-07-26-09-fix-pending-storage-key-rename.md (osh_pending_pagesストレージキーをpending_pagesにリネーム)
- 2026-07-26-10-fix-i18n-plural-integration.md (applyI18nがdata-i18n-argsのcountから複数形キーを自動解決)
- 2026-07-26-11-fix-response-for-type-completeness.md (ResponseForTypeの型マッピングを全メッセージ種別に完全化)
- 2026-07-26-12-fix-protocol-version-validation.md (プロトコルバージョン検証、実装済み・制約により対応不可と判明しクローズ)
- 2026-07-26-16-fix-pending-sqlite-queue-retry-alarm.md (pendingSqliteQueueに定期リトライアラームを追加)
- 2026-07-26-17-refactor-console-to-structured-logger.md (dashboard分のconsole出力を構造化ロガーに置き換え。Offscreen分はPBI-34に分割)
- 2026-07-26-18-refactor-sqlite-client-last-error.md (SqliteClientのlastError管理をcall()に一元化)
- 2026-07-26-19-fix-tabcache-content-removal.md (TabCacheのcontentフィールドが常にnullのデッドフィールドと判明、削除)
- 2026-07-26-20-fix-offscreen-mobile-suspend-mitigation.md (モバイル検出時にSQLiteメッセージタイムアウトを短縮、既存アラームにヘルスチェックpingを相乗り)
- 2026-07-26-23-fix-dashboard-dead-code-removal.md (未参照の旧パネル実装3ファイル+テスト4件を削除、tagsPanel.tsは別PBI-35に分割)
- 2026-07-26-37-fix-dashboard-general-missing-settings.md (PBI-27着手前の前提条件。dashboardのGeneralパネルにmin_visit_duration等3項目を追加。Body Protectionは既存実装と判明し対象外)
- 2026-07-26-25-refactor-logger-split.md (logger.ts 755行をtypes/core/apiの3ファイルに分割、呼び出し元120件が多いためlogger.tsはバレルとして維持)
- 2026-07-26-34-refactor-offscreen-console-to-logger.md (Offscreen側21件のconsole出力をログ機構経由に置き換え。offscreen.tsはLOG_FORWARDメッセージでSW中継、sqliteEngineContext.tsは既存loggerを直接呼び出し可能と判明、opfsWorker.ts(Web Worker)はpostMessage経由でsqliteEngineContextに中継)
- 2026-07-26-14-fix-offline-queue-retry-skip-ai.md (前回スキップ判断を覆し実装。OfflineJob.typeが既にobsidian_sync/ai_summaryを区別済みと判明し、recordingLogic.retryObsidianWriteOnly()を追加するだけの小規模実装で完了)
- 2026-07-26-22-refactor-barrel-reexport-removal.md (aiClient.tsは誤認識と判明し対象外。残り4バレルファイルは呼び出し元が1〜2箇所と少なく、直接import化してバレル自体を削除)
- 2026-07-26-35-fix-dashboard-tagspanel-dead-code.md (調査の結果tagsPanel.tsはpanels/staticForm/tagsSettingsPanel.tsから現役でimportされている依存モジュールと判明。削除不要でクローズ)
- 2026-07-26-33-fix-hardcoded-japanese-strings-options.md (options.html日本語ハードコード約247件をi18n化。当初想定220件+複数行パターン22件+data-i18n属性欠落19件を追加発見し対応、新規i18nキー19件追加)
- 2026-07-26-28-fix-web-accessible-resources-scope.md (web_accessible_resourcesを9パターンから2パターンに絞り込み。Content Scriptから実際に必要なのはcontent-extractor.jsとicons/icon48.pngのみと判明、残りは拡張機能内部専用リソースで宣言不要と確認。実Chrome手動確認済み)

### これまでのアーカイブ済み

- 2026-07-23-05-fix-remove-unused-exports.md (未使用エクスポート82個+型34個の削除)
- 2026-07-23-04-fix-remove-unused-files.md (未使用ファイル6個の削除)
- 2026-07-23-03-fix-remove-unused-dependencies.md (未使用依存パッケージ6個の削除)
- 2026-07-22-07-back-security-lint-rule-and-review-checklist.md (lint rules + PR template)
- 2026-07-22-01-fix-obsidian-markdown-injection-core.md (VULN-001,002,004,005)
- 2026-07-22-02-fix-obsidian-markdown-injection-downstream.md (VULN-006,007,020)
- 2026-07-22-03-fix-reliability-races-resource-exhaustion.md (VULN-003,008,011,012,014,016)
- 2026-07-22-04-fix-settings-import-bypass-ssrf.md (VULN-009,010,013)
- 2026-07-22-05-fix-master-password-lockout.md (VULN-018,021)
- 2026-07-22-06-fix-master-password-protection-integrity.md (VULN-015,017,019)
- 2026-07-21-04-refactor-hardening-diagnostics-errors.md
- 2026-07-21-03-refactor-dedup-diagnostics-panel.md
- 2026-07-21-02-refactor-ai-provider-commons.md
- 2026-07-21-01-fix-diagnostic-security.md
- 2026-07-20-12-fix-gist-sync-completeness.md
- 2026-07-20-13-fix-ai-provider-response-validation.md
- 2026-07-20-17-fix-mobile-accessibility-frontend.md
- 2026-07-20-21-fix-dashboard-i18n-locale-fallback.md
- 2026-07-20-18-fix-supply-chain-adm-zip.md
- 2026-07-20-23-fix-ci-dx-improvements.md
- 2026-07-20-19-cleanup-conflictstats-docs.md
- 2026-07-20-20-fix-external-endpoint-configurability.md
- 2026-07-20-16-feat-ai-usage-controls.md
- 2026-07-20-15-fix-logger-sw-resilience.md
- 2026-07-20-14-fix-content-script-performance.md
- 2026-07-20-22-fix-local-ai-pii-masking-order.md
- 2026-07-20-11-fix-opfs-sqlite-transaction-integrity.md
- 2026-07-20-10-feat-offline-network-queue.md
- 2026-07-20-02-fix-session-store-resilience.md
- 2026-07-20-01-fix-message-type-unification.md
- 2026-07-20-09-fix-docs-dual-translation-system.md
- 2026-07-20-08-fix-changelog-release-note-guidelines.md
- 2026-07-20-07-fix-data-integrity-cleanup.md
- 2026-07-20-06-fix-security-privacy-extensions.md
- 2026-07-20-05-fix-ui-css-touchups.md
- 2026-07-20-04-fix-content-extractor-cleansing-config.md
- 2026-07-20-03-fix-i18n-module-separation.md
- 2026-07-19-02-fix-anond-whitelist-adapter.md
- 2026-07-19-01-fix-ai-duration-measurement.md
- 2026-07-18-36-feat-automate-third-party-notices.md
- 2026-07-18-35-fix-barrel-reexport-deprecation-notice.md
- 2026-07-18-34-fix-log-source-auto-completion.md
- 2026-07-18-33-feat-message-protocol-versioning.md
- 2026-07-18-32-fix-recording-pipeline-factory-extraction.md
- 2026-07-18-31-fix-wa-sqlite-exact-version-pin.md
- 2026-07-18-30-fix-consolidate-duplicate-i18n-modules.md
- 2026-07-18-29-fix-optimistic-lock-cas-reverification.md
- 2026-07-18-28-fix-pending-sqlite-queue-batch-insert.md
- 2026-07-18-27-fix-log-retention-quota-separation.md
- 2026-07-18-26-feat-mobile-offscreen-queue-limit.md
- 2026-07-18-25-fix-remove-noop-optimistic-lock-save-sqlite.md
- 2026-07-18-24-fix-tab-switch-focus-movement.md
- 2026-07-18-23-fix-permissions-page-i18n.md
- 2026-07-18-22-fix-dashboard-tablist-aria-roles.md
- 2026-07-18-21-fix-dashboard-html-lang-attribute.md
- 2026-07-18-20-fix-session-store-storage-backend.md
- 2026-07-18-19-fix-storage-quota-unlimited-storage-check.md
- 2026-07-18-18-fix-migration-backup-columns-coverage.md
- 2026-07-18-17-fix-crypto-random-log-id-fallback.md
- 2026-07-18-16-feat-plural-locale-support.md
- 2026-07-18-15-feat-readme-architecture-and-privacy-section.md
- 2026-07-18-14-fix-uuid-override-range.md
- 2026-07-18-13-fix-popup-width-responsive.md
- 2026-07-18-12-fix-content-script-sender-validation.md
- 2026-07-18-11-fix-consent-state-changed-sender-validation.md
- 2026-07-18-10-fix-remove-dead-history-panel-code.md
- 2026-07-17-09-feat-audit-log-tsv-download.md
- 2026-07-17-08-dashboard-opfs-migration-status.md
- 2026-07-16-07-decide-opfs-migration-v2-removal.md
- 2026-07-16-06-fix-idb-fallback-subframe7536-migration.md
- 2026-07-16-05-fix-sqlite-message-type-unification.md
- 2026-07-16-04-fix-adr014-file-references.md
- 2026-07-16-02-fix-architecture-knowledge-graph-findings.md
- 2026-07-13-03-fix-sqlite-history-panel-deepening.md

## 集計

| 状態 | 件数 |
|---|---|
| ⬜ 未着手 | 1 |
| 🔶 部分実装 | 0 |
| **`pbi/` 残存合計** | **1** |
| アーカイブ済みPBI | 292 |
| アーカイブ済み実装計画 | 112 |

※ 2026-08-18: PBI-27（trustDb 6モジュール分解）を実装完了・アーカイブ。2026-08-17〜18のアーキテクチャレビュー由来の全PBIが完了。
※ 2026-08-18: plans/2026-08-01-1903-review-yasumaro.md（プロジェクト全体レビュー）を再精査。High 5件中4件・Medium多数は既存リファクタリングで解消済みと確認。低コスト3件（npm audit fix、models-dev-dialog stored XSS、PRIVACY_POLICY_VERSION失効）を修正。CI lint導入は既存83件のESLintエラーが障壁のため新規PBI-2026-08-18-01として切り出し。

※ 2026-08-17: アーキテクチャレビュー由来の14PBIを追加（06〜19）。00〜05は前回セッションから残存。
※ 2026-08-17: アーキテクチャレビュー第2弾由来の6PBIを追加（29〜34）→ 実装完了・アーカイブ済み（2026-08-17）
※ 2026-08-17: アーキテクチャレビュー第3弾由来の6PBIを追加（35〜40）→ 実装完了・アーカイブ済み（2026-08-18）。採点根拠と既存PBIとの重複は [00-backlog-architecture-deepening-batch3.md](../dev-docs/archived/pbi/2026-08-17-00-backlog-architecture-deepening-batch3.md)（アーカイブ済み）を参照。
※ 2026-08-17: 着手状況の全数調査を実施（Explore並列4本）。01〜28のうち13件が受け入れ基準を満たしアーカイブ、8件が部分実装と判明（INDEX表に🔶注記）、35〜40は新規のため全件未着手を確認。
※ 2026-08-18: PBI-01/28/23/39を実装完了・アーカイブ。部分実装の🔶注記は全て解消。親epic（00-epic-architecture-deepening-aug17.md）も子PBI全完了によりアーカイブ済み。

### 2026-08-17 アーキテクチャレビュー第2弾アーカイブ済み（6件）

PBI-29〜34。アーキテクチャレビュー（post-実装）で再スキャン実施済み。

- 2026-08-17-29-refactor-collapse-sqlite-read-seam.md (SQLite読み取りをStorageQuery値オブジェクトに統合、query/searchを単一化。IdbVfsBackend/OPFS Worker/Fallback/Noopの4アダプタをStorageQuery対応に、契約テスト追加)
- 2026-08-17-30-refactor-split-opfs-worker-god-module.md (opfsWorker 945行をreadOnlyHandler/coreCrudHandler/maintenanceBatchHandlerの3ハンドラに分割、Workerプロトコルに型付け)
- 2026-08-17-31-fix-queue-retry-duplication.md (キュー2つのリトライ再実装をflush()へ統合、pendingSqliteQueueにmax-retry付与)
- 2026-08-17-32-refactor-extract-obsidian-client-validators.md (ObsidianClient内の純関数バリデータを抽出し設定構築を一元化)
- 2026-08-17-33-refactor-unify-backend-resolver.md (バックエンド選定をBackendResolverに一元化しopfsCapabilitiesを接続)
- 2026-08-17-34-refactor-derive-cleansing-option-types.md (クレンジング型をCLEANSING_RULESから導出し手書き32フィールドを廃止)

### 2026-08-09 アーキテクチャレビュー由来（20〜24）の実施順と依存

アーキテクチャレビュー（候補01→03→04→02→05）に対応する。

```
20（候補01・ルール宣言）      ← 18の続き。✅ 完了（アーカイブ済み）
  ↓
21（候補03・変更系Result）    ← 19の続き。✅ 完了（アーカイブ済み）
  ↓
22（候補04・浅いパネル）      ← ✅ 完了（アーカイブ済み）
  ↓
24（候補05・逆依存）          ← PBI-09の後継。✅ 完了（アーカイブ済み）
  ↓
23（候補02・トランスポート）  ← 21が前提。✅ 全Phase完了（アーカイブ済み）
```

20〜24 の実装計画は完了に伴い `dev-docs/archived/plans/` へ移動済み。
