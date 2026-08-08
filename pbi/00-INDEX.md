# PBI Index

`pbi/` 配下のPBI実装状況一覧。新規PBI作成時・実装完了時はこの表を更新すること。

凡例: ⬜ 未着手 / 🔶 部分実装（一部基準のみ満たす） / 実装完了したPBIは `dev-docs/archived/pbi/` へ移動する
難易度: 🟢低（1pt目安） / 🟡中（2pt目安） / 🔴高（3pt以上目安） — 各PBI内「見積もり」セクションのポイントに基づく
副作用: 🔴あり（既存機能・既存ユーザーに実害の可能性） / 🟡軽微（コスト増や要検証点はあるが致命的でない） / 🟢なし（安全に対処可能）
種別: ✨機能追加（feat、ユーザーに見える新機能） / 🔧非機能追加（fix/refactor、バグ修正・内部改善・性能改善など機能追加を伴わないもの）

---

## 未着手 ⬜ / 部分実装 🔶

| PBI | 難易度 | 副作用 | 種別 | 概要 |
|---|---|---|---|---|
| ✅ [2026-08-08-01-refactor-recording-logic-split.md](2026-08-08-01-refactor-recording-logic-split.md) | 🟡中 | 🟡軽微 | 🔧 | RecordingLogic（541行）をRecordingCache(395行)/RecordingValidator(71行)/RecordingLogic(248行)に分割。後方互換ラッパー維持。全7556テスト合格 |
| ✅ [2026-08-08-02-refactor-ai-service-test-connection.md](2026-08-08-02-refactor-ai-service-test-connection.md) | 🟢低 | 🟡軽微 | 🔧 | AIServiceにtestConnectionを追加しADR 2026-07-27の方針を型で担保。RemoteAIServiceのsuccess/error欠落バグも修正 |
| ✅ [2026-08-08-03-refactor-panel-contract-cleanup.md](2026-08-08-03-refactor-panel-contract-cleanup.md) | 🟢低 | 🟢なし | 🔧 | refresh()をoptional化（14実装中8件は実処理を持つため削除は誤りと判明）。registryのキャストをcategory narrowingへ |
| ✅ [2026-08-08-04-refactor-messaging-layer-consolidation.md](2026-08-08-04-refactor-messaging-layer-consolidation.md) | 🟡中 | 🟡軽微 | 🔧 | 整合性テストの手書きリストをソース導出方式へ。ResponseForTypeのLOG_FORWARD欠落・AiTestProgress重複定義も解消 |
| ✅ [2026-08-08-05-refactor-ai-provider-asymmetry.md](2026-08-08-05-refactor-ai-provider-asymmetry.md) | 🟡中 | 🔴あり | 🔧 | provider間の非対称解消（Geminiの429リトライ・使用量0記録・BuiltInAiのsanitizeContent未通過）。BuiltInAiテスト12件追加 |
| ✅ [2026-08-08-06-test-untested-modules-coverage.md](2026-08-08-06-test-untested-modules-coverage.md) | 🟡中 | 🟢なし | 🔧 | recordingCacheのsession永続化・VULN-014の永続化境界・記録系ハンドラのVULN-004にテスト追加（31件） |
| ✅ [2026-08-08-07-fix-sqlite-history-pagination.md](2026-08-08-07-fix-sqlite-history-pagination.md) | 🟡中 | 🔴あり | 🔧 | **実害修正**: 履歴1000件超の51ページ目以降が閲覧不能だった問題。サーバ側ページングへ移行 |
| ✅ [2026-08-08-08-refactor-dead-code-and-seam-bypass.md](2026-08-08-08-refactor-dead-code-and-seam-bypass.md) | 🟢低 | 🟢なし | 🔧 | 死蔵判定を3点とも訂正（createBackgroundServicesは欠陥修正・popupテストは現役で移動・i18nは非等価のためseam補強） |
| 🔶 [2026-08-08-09-refactor-dashboard-dual-bootstrap.md](2026-08-08-09-refactor-dashboard-dual-bootstrap.md) | 🔴高 | 🔴あり | 🔧 | Phase1(エクスポート業務ロジック切り出し)・Phase3(registry経由化)完了。Phase2/4(逆依存解消・単一bootstrap化)は規模とE2E必須のため残 |
| ⬜ [2026-08-01-17-fix-encryption-key-session-storage.md](2026-08-01-17-fix-encryption-key-session-storage.md) | 🔴高 | 🔴あり | 🔧 | マスターパスワード未設定時の暗号化キーをchrome.storage.sessionへ移行 |
| 🔶 [2026-08-07-08-refactor-ai-client-service-unification.md](2026-08-07-08-refactor-ai-client-service-unification.md) | 🔴高 | 🔴あり | 🔧 | AIClient/AIService二重レイヤーと型ドリフト(model/modelName)の統合（modelName型ドリフトは解消済み。AIClient削除は中核パスの高リスクのため保留） |
| 🔶 [2026-08-07-13-refactor-service-wiring-backend-consolidation.md](2026-08-07-13-refactor-service-wiring-backend-consolidation.md) | 🟡中 | 🟡軽微 | 🔧 | サービス配線・StorageBackend・プロバイダ設定表示・エラー処理の統合候補（エラー処理イディオムは解消済み。他は調査により実重複でない/高リスクと判断し保留）
| ✅ [2026-08-09-10-fix-dashboard-sqlite-lasterror-snapshot.md](2026-08-09-10-fix-dashboard-sqlite-lasterror-snapshot.md) | 🟢低 | 🟡軽微 | 🔧 | **実害修正**: deps.lastErrorが起動時nullで凍結され、15箇所の具体的エラー文言が一度も表示されていなかった問題をgetter化で解消 |
| 🔶 [2026-08-09-11-refactor-dashboard-sqlite-dual-wiring.md](2026-08-09-11-refactor-dashboard-sqlite-dual-wiring.md) | 🟡中 | 🟡軽微 | 🔧 | createSqliteClientDepsで本番/テストの配線を共有化。未テストだったSW所有4依存にテスト追加。wrapper削除(72箇所)は残 |
| ✅ [2026-08-09-12-fix-querylogs-error-swallowing.md](2026-08-09-12-fix-querylogs-error-swallowing.md) | 🟡中 | 🟡軽微 | 🔧 | **実害修正**: DB障害時に空ファイルをDLし「completed」表示していた問題。tagClusterのリトライ無効化・1万件超の無言切り捨ても修正 |
| 🔶 [2026-08-09-13-refactor-sender-trust-policy.md](2026-08-09-13-refactor-sender-trust-policy.md) | 🟡中 | 🔴あり | 🔧 | registryに信頼レベルを必須化。無防備だったREFRESH_LOCAL_MARKDOWN_SCHEDULER等を強化。handler側の個別チェックは二重防御として残置 |
| ✅ [2026-08-09-14-refactor-remove-offscreen-sqlite-shim.md](2026-08-09-14-refactor-remove-offscreen-sqlite-shim.md) | 🟢低 | 🟢なし | 🔧 | 非推奨再エクスポート層を削除。vi.mockを本番の import 先に合わせ offscreen テストが152→175件に |
| ✅ [2026-08-09-15-investigate-markdown-sanitizer-divergence.md](2026-08-09-15-investigate-markdown-sanitizer-divergence.md) | 🟢低 | 🟢なし | 🔍 | 調査完了・**対応不要**。ADRが用途別使い分けを定めており、リンク構文を組まない側は現状が正しい |

---
> 2026-08-04-01〜05 は Checking Team レビュー（v6.7.12 AI接続テスト進捗表示）の残存指摘対応として実装・アーカイブ済み。詳細はアーカイブ欄参照。
> 2026-08-06-01 は Tag Cluster タグ未マッチ時全文検索フォールバック機能として v6.7.17 で実装・アーカイブ済み。

---
> 2026-08-02-01〜05 はテストカバレッジ拡充（prompt injection マトリクス / optimistic lock ストレス / privacy pipeline PII リーク / Obsidian APIキー漏洩防止 / SQLite unique 制約）として実装・アーカイブ済み。詳細はアーカイブ欄参照。

---

## アーカイブ

完了済みPBIは `dev-docs/archived/pbi/` へ移動する。
新規PBIは `pbi/YYYY-MM-DD-NN-type-slug.md` として作成してください（`type`は`feat`/`fix`/`refactor`/`doc`のいずれか。ファイル名の種別がそのまま機能追加/非機能追加の判定基準になる）。

---

## アーカイブ

完了済みPBIは [dev-docs/archived/pbi/](../../dev-docs/archived/pbi/) に移動する。

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

### 2026-08-02 セッションでアーカイブ済み

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
| ⬜ 未着手 | 1（✨機能追加 0 / 🔧非機能追加 1） |
| ✅ 完了 | 1（2026-08-08-01 RecordingLogic 分割） |
| 🔶 部分実装 | 2（2026-08-07-08 AIレイヤー統合 / 2026-08-07-13 サービス配線・StorageBackend） |
| アーカイブ済み | 210 |
