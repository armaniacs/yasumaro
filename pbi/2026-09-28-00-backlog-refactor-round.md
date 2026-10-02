# Backlog — 2026-09-28 全体リファクタリングラウンド採点台帳

ユーザー要求「リポジトリ全体のリファクタリング（PBI 作成まで・実装は別ラウンド）」に基づく差分レビューの採点台帳。

- レビュー方法: 4 観点（DRY / SRP・モジュール分離 / 型安全性・テスト容易性 / 堅牢性）を機械的走査（並列実装の横並び比較・cast 網羅・リスナー/タイマー網羅・storage 直触り網羅）+ 実コード裏取り（file:line 確認）で実施。graphify グラフでモジュール群を俯瞰後に精読。
- 差分スコープ: 進行中 PBI（utils 再編 30・wa-sqlite サンセット 32・マスターパスワード re-encrypt）と live 台帳（2026-09-05-00-backlog-future.md）に登録済みのトリガー待ち候補は再掲しない。
- 検証コマンド 4 役割: 型検査 `npm run type-check` / lint `npm run lint` / テスト `npm test` / ビルド `npm run build`（実装ラウンドで使用）。

## 採点結果（実行順）

RICE = Reach（今後 1 年の関与頻度 1-10）× Impact（3=実害解消 / 2=大きい / 1=中）× Confidence ÷ Effort（SP）。同点はリスク軽減効果→時間的緊急度で決定。

| NN | PBI | 種別 | R | I | C | E | RICE | SP | 依存 / 備考 |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 01 | [fix-ai-rate-limit-max-reader-writer-split](../dev-docs/archived/pbi/2026-09-28-01-fix-ai-rate-limit-max-reader-writer-split.md) | fix | 6 | 3 | 100% | 0.5 | 36.0 | 0.5 | 実害: UI 設定が読まれず常に既定値。getMaxMonthlyTokens の 2026-09-22 修復と同形の未修復残 |
| 02 | [refactor-domain-filter-cache-save-seam-adoption](../dev-docs/archived/pbi/2026-09-28-02-refactor-domain-filter-cache-save-seam-adoption.md) | refactor | 5 | 2 | 100% | 0.5 | 20.0 | 0.5 | 専用 seam が存在するのに byte 同一 IIFE 4 箇所が残存。delta-write 契約（2026-09-17-17）違反 |
| 03 | [fix-init-export-scheduler-immediate-flush-loss](../dev-docs/archived/pbi/2026-09-28-03-fix-init-export-scheduler-immediate-flush-loss.md) | fix | 3 | 3 | 100% | 0.5 | 18.0 | 0.5 | 実害: 設定保存/接続テスト直後の当日 export が黙って消える |
| 04 | [fix-apply-i18n-args-parse-fail-closed](../dev-docs/archived/pbi/2026-09-28-04-fix-apply-i18n-args-parse-fail-closed.md) | fix | 3 | 3 | 90% | 0.5 | 16.2 | 0.5 | 1 属性の malformed JSON でパネル翻訳一式が死ぬ。現行テストが throw を pin（要更新） |
| 05 | [refactor-settings-backup-restore-single-source](../dev-docs/archived/pbi/2026-09-28-05-refactor-settings-backup-restore-single-source.md) | refactor | 3 | 2 | 100% | 0.5 | 12.0 | 0.5 | バックアップ復元の二重実装 + リテラルハードコード drift |
| 06 | [fix-local-markdown-export-retention-hardening](../dev-docs/archived/pbi/2026-09-28-06-fix-local-markdown-export-retention-hardening.md) | fix | 3 | 3 | 100% | 1 | 9.0 | 1 | 実害: 失敗時の孤児バッファが無期限蓄積（1.4-2.2MB/日）+ flush O(N) 退行 + RMW 競合 |
| 07 | [refactor-field-validation-descriptor-activation](../dev-docs/archived/pbi/2026-09-28-07-refactor-field-validation-descriptor-activation.md) | refactor | 5 | 2 | 90% | 1 | 9.0 | 1 | デスクリプタ汎用経路が死んでおり手書き 12 関数と 3 重管理。docstring が現状と不一致 |
| 08 | [fix-removed-counts-type-pollution](../dev-docs/archived/pbi/2026-09-28-08-fix-removed-counts-type-pollution.md) | fix | 2 | 3 | 100% | 1 | 6.0 | 1 | 実害: 文字列（reason 名・byte 数）が removal count 地図に混入し feedback view に表示される |
| 09 | [refactor-asyncdata-panel-reload-lifecycle](../dev-docs/archived/pbi/2026-09-28-09-refactor-asyncdata-panel-reload-lifecycle.md) | refactor | 6 | 2 | 90% | 2 | 5.4 | 2 | 9 パネル × 約 22 行の reload 骨格重複。期間フォールバック 2 系統 drift を是正 |
| 10 | [refactor-layer0-limits-ssot](../dev-docs/archived/pbi/2026-09-28-10-refactor-layer0-limits-ssot.md) | refactor | 4 | 2 | 100% | 1.5 | 5.3 | 1.5 | Layer 0 cap 定数の SSOT 化。14 が 10 に依存 |
| 11 | [refactor-local-date-utilities-ssot](../dev-docs/archived/pbi/2026-09-28-11-refactor-local-date-utilities-ssot.md) | refactor | 4 | 2 | 90% | 1.5 | 4.8 | 1.5 | format 7 + parse 5 + 日レンジ 3 の再実装。DST 取り込み漏れと日付正規化 2 ポリシー併存（実害 2 件）。テスト pin の更新が要る。10 と tagClusterTimeSliderPanel.ts でファイル重複 → 09 の後 |
| 12 | [investigate-session-store-overflow-persistence](../dev-docs/archived/pbi/2026-09-28-12-investigate-session-store-overflow-persistence.md) | investigate | 3 | 2 | 80% | 1 | 4.8 | 1 | 保存 URL ~9k 件で session 永続化が恒久停止し毎 flush が O(n) serialize。cap 値と戦略の裁定が前提 |
| 13 | [refactor-layer-boundary-hygiene-bundle](../dev-docs/archived/pbi/2026-09-28-13-refactor-layer-boundary-hygiene-bundle.md) | refactor | 3 | 1.5 | 100% | 1 | 4.5 | 1 | 小型境界違反 4 件のバンドル（gistSettings DI 迂回・opfsCapabilities 純 core 分離・auditLog 移設・DiagnosticsCollector 偽 union 解消） |
| 14 | [refactor-messaging-background-edge-removal](../dev-docs/archived/pbi/2026-09-28-14-refactor-messaging-background-edge-removal.md) | refactor | 4 | 2 | 90% | 2 | 3.6 | 2 | 中立層 messaging が background に runtime 依存（4 edge）+ CURRENT_PROTOCOL_VERSION 2 経路。**10 に依存**（validators.ts / limits 関連が重なる） |
| 15 | [refactor-status-message-unification](../dev-docs/archived/pbi/2026-09-28-15-refactor-status-message-unification.md) | refactor | 4 | 1.5 | 80% | 1.5 | 3.2 | 1.5 | status 表示 8 実装・class 契約 2 系統（CSS と非互換を実証）。**07 に依存**（settingsPipeline.ts 重複） |
| 16 | [refactor-preview-flow-payload-typing](../dev-docs/archived/pbi/2026-09-28-16-refactor-preview-flow-payload-typing.md) | refactor | 2 | 2 | 90% | 1.5 | 2.4 | 1.5 | popup の 3 payload 再宣言と `as unknown as ExtensionMessage`。maskedCount 誤搬送を構造的に排除 |
| 17 | [refactor-render-tag-graph-extraction](../dev-docs/archived/pbi/2026-09-28-17-refactor-render-tag-graph-extraction.md) | refactor | 2 | 1 | 100% | 1 | 2.0 | 1 | **既存台帳（archloop-0924）からの昇格**。トリガー「3つ目のクラスタグラフ系パネル追加時」が発火済み（wordCluster・timeSlider が第 2・3 実装） |

台帳送り（トリガー管理・PBI 化せず）は本ファイル末尾。

## 依存マップ

```
10 (Layer 0 caps SSOT) ──→ 14 (messaging 逆辺解消)
07 (fieldValidation) ──→ 15 (status message: settingsPipeline.ts 共通)
09 (asyncData lifecycle) ──→ 11 (local date: tagClusterTimeSliderPanel.ts 共通)
08 (removedCounts: messaging/types.ts) ──→ 14 (同ファイル)
```

実行順は RICE 降順を主とし、上記依存を NN に反映済み（依存先が常に先の NN）。同一バッチ並列化はファイル非重複で判定すること（例: 01/03/04/06 は相互非重複で並列可）。

## 逸脱の記録

- 06（fix）と 07（refactor）の同点 9.0 は、データ無限増長というリスク軽減効果を優先し 06 を先に。
- 11（refactor）と 12（investigate）の同点 4.8 は、DST 起因のデータ取り込み漏れという現行実害の是正を優先し 11 を先に。
- 13 のバンドルは 4 件の独立小型境界違反を 1 PBI に束ねた（単独 PBI 化では DoD が希薄になるため。ファイルは相互非重複）。

## 台帳送り（トリガー発火時に PBI 化）

| 項目 | 種別 | RICE 目安 | 再検討トリガー |
|------|------|-----------|----------------|
| ARCHIVE_SCOPE_BY_SUBTYPE の型化（`Record<string, …>` → `Record<DashboardSqliteSubtype, ScopeBinding>`。非 archive subtype の scope hash assert が構造的に死んでいる。verify 側は fail-closed のため実害なし・設計ギャップ） | refactor | 1.5 | confirm token / dashboardGateway のスコープ改修時（`src/messaging/sqliteOperationSecurity.ts:177`・`src/messaging/dashboardGateway.ts:78-93`） |
| StorageKeyValues の enum-by-convention 狭窄（PRIVACY_MODE / DOMAIN_FILTER_MODE 等 6 キーが `string` 拡幅。`privacySettings.ts:79` の CSS セレクタに生値補間で不正値時に DOMException。`CSS.escape` 併用） | refactor | 2.0 | privacy / domainFilter パネル改修時、または不正保存値での panel crash 報告時（`src/utils/storage/types.ts:311,331,333,451`） |
| offscreen の SQL ドメイン分離（queryPlan.ts 637 行・schema.ts 513 行は純関数だが offscreen/ 配置。background → offscreen runtime edge 残存 2 本（inMemoryTransport.ts:29-30）+ テストダブルの production tree 配置） | refactor | 1.5 | **PBI 30（utils 再編）の統合順序確定時**に同時検討（物理移動テーマの共有） |
| settingsMigration の provider loopback grandfathering 分離（:551-591 の 41 行が providerAllowlist 責務で他 3 責務と共有 state ゼロ） | refactor | 1.5 | settingsMigration 改修時（旧 crypto 復号 fallback 部は KeyDerivation 既知項目と合流） |
| deriveMigrationStatus の純モジュール抽出（diagnosticsPanel.ts:378-460 の 83 行が render モジュール内に純判断として物理配置） | refactor | 1.2 | 診断パネル改修時（`src/dashboard/panels/diagnostic/diagnosticsPanel.ts`） |
| trustChecker alert 4 キー・feedbackQueue の残キー裁定（01 のスコープ外。blob 宣言と top-level 実体の不一致の残部。export で落下巴底） | fix | 1.5 | settings export/import 改修時（`src/utils/trustChecker.ts:69-127`・`src/utils/aiSummaryCleaner/feedbackQueue.ts:21-27`） |
| ProviderStrategy の error 文面 → status 逆パース除去（`msg.match(/HTTP\s+(\d+):/)` を structured failure taxonomy 経由へ。ErrorTaxonomy 統合（既知項目）と合流させる） | refactor | 2.0 | structured failure taxonomy の次回改修時（`src/background/ai/providers/ProviderStrategy.ts:253-254`） |
| chrome.runtime.onInstalled / onStartup の unhandled rejection 保護（lifecycleHandlers.ts:64-66 が try 外。alarmRegistry.ts:170-178 が正規形） | fix | 2.0 | lifecycle / migration 経路の次回改修時に同梱（`src/background/handlers/lifecycleHandlers.ts`・`src/background/service-worker.ts:254-255`） |

## 既存台帳への反映

- `pbi/2026-09-24-00-backlog-archloop-0924.md` の「renderTagGraph 抽出」: トリガー発火済みのため本ラウンド PBI 17 に昇格（行に昇格印を追記済み）。
- `pbi/2026-09-05-00-backlog-future.md` の「2 wire table の dashboard-hop codec 形状統合（P3）」: archiveWireTable 行内の `backendArgs`/`depsArgs` 双子（7 行 byte 同一・`archivePreview` のみ `includeDeleted` 正規化が乖離、`:219/220` 等対 `:126/127`）を P3 着手時の同梱対象として追記。

## クリーンと確認した領域（再レビュー不要）

- `src/messaging/validators.ts` の DASHBOARD_SQLITE_SUBTYPE_SPECS（述語合成で完全表駆動）
- `src/background/handlers/`（deps interface + factory 化済み・handler 内 inline ビジネスロジックなし）
- `src/content/`（visit 系は DOM 参照ゼロの純モジュール）
- `src/background/persistentRetryQueue.ts`（port 注入済み generic queue）
- `BackendOrError` / `sqliteValidators.ts` のデコーダ（mapped-type exhaustive assert の規範実装）
- production の non-null assertion は 7 件のみで全て直前ガード付き
- production の `JSON.parse` 12 箇所のうち 11 箇所はガード済み（唯一の未ガードが PBI 04）

## ラウンド完了時に判明した残課題（2026-09-28 バッチ 1〜3 の実装から）

| 項目 | 種別 | 再検討トリガー |
|------|------|----------------|
| status 表示の stale-timer race（古いタイマーが新しいメッセージを clear し得る。showStatus 統一で構造は 1 箇所に集約済み、タイマー管理だけが残留） | fix | 次回 settingsUiHelper 改修時（`src/utils/ui/settingsUiHelper.ts`） |
| showStatus の全要素書き換えが markup 側 utility class（`status-message-spaced` / `mt-4`）を落とす | refactor | 次回 status 要素のマークアップ変更時（`src/utils/ui/statusMessageCssContract.test.ts` に pin 済み） |
| popup `statusPanel.ts` の `mainStatus` writer（:317-350）が素 class を書く旧経路のまま（15 の 8 変種対象外だった） | refactor | 次回 popup statusPanel 改修時 |
| `SVG_NS` が `src/dashboard/tagClusterLoading.ts:15` と `tagFrequencyTimelinePanel.ts:37` に残留（17 は panels/asyncData 配下のみ単一化。root→panels 方向の import 制約が理由） | refactor | 次回 tagClusterLoading 改修時。`src/utils/computeLimits.ts:11` の MAX_NODES 参照コメントも同時に更新 |
| DST 曖昧時刻（夜中遷移ゾーン例: America/Santiago）で `setHours(23,59,59,999)` が反復 23:00-23:59 を取りこぼす（periodFilter 由来の継承仕様。CI の TZ=UTC では観測不能） | investigate | タイムゾーン多様性の製品要件が生じた時（`src/utils/localDate.ts`） |
| aiSummaryCleansingSettingsV2 の full-snapshot writer 残存（02 のスコープ外。delta への局所修正で完結） | refactor | 次回 aiSummaryCleansingSettingsV2 改修時（`src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:151/:171`） |
| 新規 cleansing feedback エントリに AI 統計が永続化されない（`CleansingFeedbackEntry` の wire 契約変更が必要 = 別 PBI） | fix | feedback データの分析要件が生じた時（`src/utils/aiSummaryCleaner/feedbackQueue.ts`） |

## 追加ラウンド: 残課題の PBI 化 + sessionStore 後続 fix（2026-09-28）

「ラウンド完了時に判明した残課題」7 件を 5 PBI に整理（status 関連 3 件はバンドル）し、ADR の裁定に基づく sessionStore 後続 fix PBI を起票した。実行順は RICE 降順（ファイル非重複のため並列可）。

| NN | PBI | 種別 | R | I | C | E | RICE | SP | 出典 |
|---|---|---|---:|---:|---:|---:|---:|---:|---|
| 18 | [fix-session-store-flush-cap-stagnation-drop](../dev-docs/archived/pbi/2026-09-28-18-fix-session-store-flush-cap-stagnation-drop.md) | fix | 3 | 3 | 100% | 1 | 9.0 | 1 | investigate 12 の裁定（ADR 2026-09-28-session-store-overflow-persistence） |
| 19 | [refactor-status-message-residual-bundle](../dev-docs/archived/pbi/2026-09-28-19-refactor-status-message-residual-bundle.md) | refactor | 3 | 1.5 | 90% | 1 | 4.05 | 1 | 残課題 1-3（stale-timer race・markup class 落ち・mainStatus 旧経路） |
| 20 | [refactor-ai-summary-cleansing-settings-delta-write](../dev-docs/archived/pbi/2026-09-28-20-refactor-ai-summary-cleansing-settings-delta-write.md) | refactor | 2 | 1 | 100% | 0.5 | 4.0 | 0.5 | 残課題 6（full-snapshot writer。実読の結果 writer は 1 本で :171 は同関数内の代入行 — PBI 側に記録済み） |
| 21 | [fix-cleansing-feedback-ai-stats-persistence](../dev-docs/archived/pbi/2026-09-28-21-fix-cleansing-feedback-ai-stats-persistence.md) | fix | 2 | 2 | 80% | 1 | 3.2 | 1 | 残課題 7（CleansingFeedbackEntry への加算的 optional フィールド・後方互換） |
| 22 | [investigate-dst-ambiguous-day-end](../dev-docs/archived/pbi/2026-09-28-22-investigate-dst-ambiguous-day-end.md) | investigate | 1 | 1 | 80% | 0.5 | 1.6 | 0.5 | 残課題 5（localDate endOfLocalDayMs の曖昧時刻） |
| 23 | [refactor-svg-ns-single-source](../dev-docs/archived/pbi/2026-09-28-23-refactor-svg-ns-single-source.md) | refactor | 1 | 0.5 | 100% | 0.5 | 1.0 | 0.5 | 残課題 4（SVG_NS 残留 + computeLimits doc drift） |

依存なし（先行 PBI 01-17 はすべて着地済み）。ファイル非重複のため全 6 件並列実装可。18 は上流 ADR の受入基準をそのまま継承。
