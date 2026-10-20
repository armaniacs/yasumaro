# リファクタリング診断バックログ（2026-10-20）

> `/yasumaro-refactor` による読み取り専用診断の結果台帳。7 レンズ（DRY / SRP / 型 / 副作用 / エラー処理 / 命名 / 挙動境界）でリポジトリ全体を 4 パス（9 体の走査 + 主スレッド横断）で診断し、約 190 件の発見を 24 PBI + 対象外 17 件へ統合した。

## RICE スコア表（全 24 PBI）

RICE = Reach（影響する呼び出し箇所・モジュール数）× Impact（1-3: 将来の変更コスト・バグ温床リスク）× Confidence（0.5-1.0: 裏取りの強さ）÷ Effort（人日）

| 順位 | PBI | テーマ | Reach | Impact | Conf | Effort | RICE |
|---|---|---|---|---|---|---|---|
| 1 | [2026-10-20-01](2026-10-20-01-refactor-log-argument-swap.md) | ログ引数 Swap 修正 | 38 | 2 | 1.0 | 1.0 | 76 |
| 2 | [2026-10-20-02](2026-10-20-02-refactor-error-normalization-unification.md) | エラー正規化の errorMessage 統一 | 30 | 2 | 1.0 | 1.0 | 60 |
| 3 | [2026-10-20-03](2026-10-20-03-refactor-console-to-logger-seam.md) | console 直呼びの logger seam 統一 | 44 | 2 | 1.0 | 1.5 | 58 |
| 4 | [2026-10-20-04](2026-10-20-04-refactor-constant-ssot-consolidation.md) | 定数 SSOT 統合（mirror 契約） | 25 | 2 | 1.0 | 1.0 | 50 |
| 5 | [2026-10-20-05](2026-10-20-05-refactor-settings-read-ladder.md) | 設定読み取り 3 段ラッダー共通化 | 8 | 3 | 1.0 | 0.5 | 48 |
| 6 | [2026-10-20-06](2026-10-20-06-refactor-wasm-url-ssot.md) | WASM URL リテラルの SSOT 化 | 7 | 3 | 1.0 | 0.5 | 42 |
| 7 | [2026-10-20-07](2026-10-20-07-refactor-dead-code-removal.md) | 未使用エクスポート・死にコード削除 | 19 | 2 | 1.0 | 1.0 | 38 |
| 8 | [2026-10-20-08](2026-10-20-08-refactor-csp-queue-machine-removal.md) | cspValidator キュー実行マシン削除 | 8 | 2 | 1.0 | 0.5 | 32 |
| 9 | [2026-10-20-09](2026-10-20-09-refactor-tranco-change-detector-removal.md) | TrancoChangeDetector 削除（271 行） | 5 | 3 | 1.0 | 0.5 | 30 |
| 10 | [2026-10-20-10](2026-10-20-10-refactor-encryption-session-dedup.md) | encryptionSession 内重複の集約 | 10 | 3 | 1.0 | 1.0 | 30 |
| 11 | [2026-10-20-11](2026-10-20-11-refactor-sendwithpolicy-type-constraint.md) | sendWithPolicy 型制約 | 6 | 2 | 1.0 | 0.5 | 24 |
| 12 | [2026-10-20-12](2026-10-20-12-refactor-naming-comment-cleanup.md) | 命名・コメント・文言整備 | 24 | 1 | 1.0 | 1.0 | 24 |
| 13 | [2026-10-20-13](2026-10-20-13-refactor-testdir-default-double-contract.md) | testDir 既定ダブルの契約整備 | 20 | 2 | 1.0 | 2.0 | 20 |
| 14 | [2026-10-20-14](2026-10-20-14-refactor-silent-catch-visualization.md) | 空 catch・握りつぶしの可視化 | 6 | 2 | 1.0 | 0.6 | 20 |
| 15 | [2026-10-20-15](2026-10-20-15-refactor-crypto-params-score-ssot.md) | cryptoParams スコアリング SSOT 化 | 5 | 2 | 1.0 | 0.5 | 20 |
| 16 | [2026-10-20-16](2026-10-20-16-refactor-settings-migration-types.md) | settingsMigration 型整備 | 6 | 3 | 1.0 | 1.0 | 18 |
| 17 | [2026-10-20-17](2026-10-20-17-refactor-dashboard-scaffold-dedup.md) | dashboard 同型スカフォールド共通化 | 9 | 2 | 1.0 | 1.0 | 18 |
| 18 | [2026-10-20-18](2026-10-20-18-refactor-fetch-retry-ssrf-consolidation.md) | fetch/ssrf リトライ・判定共通化 | 5 | 3 | 1.0 | 1.0 | 15 |
| 19 | [2026-10-20-19](2026-10-20-19-refactor-testability-seams.md) | テスト容易性整備（時間 seam） | 7 | 2 | 1.0 | 1.0 | 14 |
| 20 | [2026-10-20-20](2026-10-20-20-refactor-type-safety-cleanup.md) | 型安全性整備の残り | 14 | 2 | 1.0 | 2.0 | 14 |
| 21 | [2026-10-20-21](2026-10-20-21-refactor-remaining-dry-consolidation.md) | 残りの DRY 集約（生成系・シーム） | 10 | 2 | 1.0 | 1.5 | 13 |
| 22 | [2026-10-20-22](2026-10-20-22-refactor-background-consolidation.md) | background 内同形複製の共通化 | 6 | 2 | 1.0 | 1.0 | 12 |
| 23 | [2026-10-20-23](2026-10-20-23-refactor-sqlite-handler-types.md) | sqlite ハンドラ層の型整備 | 4 | 3 | 1.0 | 1.0 | 12 |
| 24 | [2026-10-20-24](2026-10-20-24-refactor-srp-splits.md) | SRP 分割（3 単位） | 3 | 3 | 0.5 | 2.0 | 8 |

## 依存グラフと実施順の推奨

- **並列可**: 01 / 05 / 06 / 08 / 09 / 11 / 13 / 14 / 15 / 18 / 19 / 22 / 24 は互いに独立（触れるファイルが重複しない）
- **衝突あり**: 02（エラー正規化）と 03（console→logger）は同じ catch ブロックを触ることが多い → 03 を先に、02 を後に（または同時に 1 ブランチで）
- **前後関係**: 07（死にコード削除）を先に実施すると、21 の parseDomainList/DomainFilter.parse 集約と 08 の cspValidator 関連が縮小する。08 → 21 の順を推奨
- **前提**: 21 の ID 生成統合は generateId.ts（PBI 2026-10-03-24）が先行実装済みであることが前提
- **関連**: 09（TrancoChangeDetector 削除）は下記対象外 6（TRANCO_NOTIFICATION_SHOWN キー統一）を解消する部分を含む
- **weekly 相当の定期確認**: 16（settingsMigration 型整備）と 23（sqlite ハンドラ型整備）は型検査の保護が目的で、先行の 11（sendWithPolicy 制約）とパターンを合わせるとよい

## 対象外リスト（挙動変更を伴うため PBI 化しない・fix/owner 判断）

成功パス・失敗パスの返却契約やストレージ契約、パーサ文法、ID 形式、UX に触れる候補。リファクタリング PBI としては扱わない（fix 型 PBI として別途起票するか、owner 判断）。

1. **TOP_LEVEL_ONLY_KEYS への未収載キー追加**（fix・高優先）: AI_USAGE_* / AI_RATE_LIMIT_* の 6 キー（src/utils/aiUsageTracker.ts:129-141 ほか）と OPFS/IDB/YASUMARO 移行フラグ群（src/offscreen/sqliteEngineHost.ts:253,413 ほか）が src/utils/storage/settingsMigration.ts:144-177 の allowlist 未収載。settings_migrated 記録が unverified/corrupt になった profile で migration が再実行されると、blob への移行 + 生キー削除で月次トークン会計・レート制限ウィンドウ・resume フラグが silently リセットされる
2. **message validator 追加**（fix）: GENERATE_REVIEW_SUMMARY の validator 未登録 + 'monthly' 以外を weekly に silently フォールバック（src/background/handlers/systemHandlers.ts:347-350）/ TEST_AI の 3 者食い違い（registry NO_PAYLOAD vs sender payload: {} vs gate 例外、src/messaging/messageTypeRegistry.ts:80 + envelopePolicy.ts:133-138）/ MANUAL/PREVIEW/SAVE_RECORD の byte-stat 検証欠落（src/messaging/validators.ts:576-604）/ LOG_FORWARD の validator 未登録 + 未知 level の silently 降格
3. **unhandled rejection・偽成功表示**（fix）: customPromptManager handleSavePrompt（361-418）/ markdownTemplateManager handleSaveClick（357-407）/ trustSettings saveTrustSettings（:411 + void ハンドラ :507-565）/ onboardingWizard（:111）/ service-worker.ts:278 の alarm リスナ guard 未適用 / flushScheduler の guard 未適用 + suspend タイムアウト 3000ms ハードコード / entrypoints/content/index.ts:9 の floating promise（catch も void もなし）
4. **statusPanel outerHTML フォールバック**（fix）: src/popup/statusPanel.ts:370-372 が popup 自身の HTML を送る誤データ
5. **checkPermissionStep の raw TypeError**（fix）: src/background/pipeline/steps/checkPermissionStep.ts:52、INVALID_URL 正規化
6. **TRANCO_NOTIFICATION_SHOWN キー統一**: SSOT 宣言キー（'tranco_notification_shown'）と実装の生リテラル（'tranco_last_notification'）の二重管理。PBI 09 の削除で解消
7. **settingsBackup 辞書順ソート問題**: src/utils/storage/settingsBackup.ts:24-27 が lexicographic で _9 > _10（kept-as-is コメント付き、owner 判断）
8. **restorableSettings allowlist 行**: 'safety_mode' / 'tranco_tier'（src/utils/storage/restorableSettings.ts:114-115、owner 判断）
9. **ALLOW_ALL_URLS_OPT_IN writer 不在**: src/utils/contentFetchGateway.ts:111-117 が唯一の reader で writer なし（import-only パス、製品判断。reader の blob 経由整合は PBI 04 で扱う）
10. **ublockParser 2 構文統合・transform ID 形式**: negatedDomains の 2 分枝文法（src/utils/ublockParser/options.ts:92-121）、ID 形式変更
11. **trustDb isValidTld 挙動不一致の統一**: domainVerifier（multi-label true）vs domainValidation（single-label false）の判定差、統一は挙動変更。共通部分の抽出は PBI 21 で扱う
12. **i18n 直書き 3 ファイル**: src/dashboard/researchSessionsPanel.ts / priorityListView.ts / models-dev-dialog.ts の aria-label 英語（data-i18n キー追加は挙動変更）
13. **日本語固定フォールバック**: src/dashboard/settingsPipeline.ts:95（saveErrorText）と trustSettings.ts:672,678,683（en ロケールでキー欠落時のみ日本語露出、文言契約に触れる）
14. **confirmDialog デフォルト 'Delete'**: src/utils/ui/confirmDialog.ts:132、非削除の確認 2 箇所（settingsExportImportUiCore.ts:182 / popup/pendingPages.ts:210）がそのまま使用、デフォルト変更か呼び出し側明示化かの判断が必要
15. **markdownTemplateUtils getHostname 並行定義**: フォーマット契約が異なる（'' vs '[INVALID_URL]'）ため統一は挙動変更
16. **markdownFormatter toLocaleString ロケール**: src/utils/markdownFormatter.ts:214 の heading スタイル、出力が環境依存（修正は挙動変更）
17. **exportLogsPanel の UTC 日付残存**: src/dashboard/panels/diagnostic/exportLogsPanel.ts:23,109 + localMarkdownExport.ts:62 + background/reviewSummaryGenerator.ts:144。PBI 2026-09-21-12 の SSOT（localDate.ts）と不整合、修正は出力契約に触れる（fix 型として別途起票推奨）

## 飽和の根拠と打ち切り

- **実施パス**: パス1（5 領域サブエージェント: utils storage/crypto/trustDb 29 件・utils text/pipeline 28 件・background 21 件・dashboard 21 件・offscreen/messaging/popup/content 25 件）、パス2（2 体: 契約境界整合 10 件・横断重複/エラー経路 11 件）、パス3（2 体: 未探索ファイル 13 件・wasm/eslint/scripts/testDir/entrypoints 10 件）、パス4（最終確認 1 体 9 件）、主スレッド横断（aiUsageTracker ラッダー・cryptoParams・fetch リトライ・cspValidator・TrancoChangeDetector の検証）
- **裏取り**: 各候補とも file:line・呼び出し元実数（Grep）・テスト有無の 3 点を確認。3 点未確認の指摘は除外した。意図的設計（envelopePolicy の診断カウンタ、piiSanitizeHybrid の e2e 用 console.warn、contentDedupHybrid の STAGED 状態、issueReportLink.ts:202 の開発者コンソール専用 console）は候補から除外
- **打ち切り**: 新規 0 件のパス 2 回連続には未到達（パス4 が 9 件）。未探索として残った領域: src/dashboard/panels/asyncData・staticForm・diagnostic の残り未深読みファイル、src/utils ルートの残り純粋関数群（パス4 で WHYS コメント充実を確認済み）、eslint/__tests__・testDir のテスト実装詳細。診断の実効網羅は主要領域（utils・dashboard・background・offscreen・messaging・popup・content・wasm・entrypoints）に及んでいる
- **refuted（意図的設計として検証済み）**: settingsUiHelper.ts:92（PBI 2026-09-22-01 裁定）、aiSummaryCleaner/helpers.ts:276（同裁定）、MessageRouter.ts:91 の message: any（contravariance コメント + eslint-disable 付き）、PrivacyCache normalizeUrlForCache（utils/urlUtils.ts:36-48 とバイト同一だが呼び出し契約が分離している設計 → PBI 04 の定数 SSOT 統合に含めるかは実装時に判断）

## 次のアクション

1. 本バックログの RICE 順に arch-delivery-loop で実装を開始する（01〜03 が最初の 1 セット。02/03 は 1 ブランチでの同時実施を推奨）
2. 対象外リスト 1〜3 は fix 型 PBI として起票を推奨（特に 1 の migration 再実行リセットと 2 の validator 追加は silent failure の解消）
3. 実装時は PBI ごとの DoD（npm run validate・シナリオ対応テスト・既存テスト全通過）を満たすこと
