# 2026-10-07 arch-delivery-loop ラウンド バックログ台帳（archloop-1007）

## 出所

- arch-delivery-loop の closed loop（診断→PBI化→自律実装→検証→版上げ）をコードベース全体（差分スコープ）に対して実行する継続ラウンド。
- 4 系統の並列 explore agent 調査（bench+background misc / query+codec 契約+offscreen / S5 残留モジュール / 設計約束乖離スイープ）+ 統合側による file:line 実コード裏取り。主要候補 10 件は統合側が直接裏取り済み。
- 診断レポート: `/tmp/architecture-review-2026-10-07-archloop-1007.md`
- 差分スコープ: 過去台帳（holistic-1005 32件 / archloop-1006 23件）で閉じたテーマは対象外。archloop-1006 台帳送り S3–S6 を優先入力に含めた（S3→NN15、S4→NN01/05/10、S5→NN11/16、S6→NN13）。
- NN01–NN17 に起票。本台帳は RICE 採点・順位根拠・依存・バッチ計画の SSOT。

## RICE 採点表（RICE 降順）

RICE = R × I × C / E。Reach は保守関与頻度（5=月次 / 4=四半期頻 / 3=四半期 / 2=半年 / 1=年次以下）。Impact 3=実害解消 / 2=大きい / 1=中（重複削減・規範化）/ 0.5=小。Confidence 1.0=コードで確定 / 0.8=設計判断が残る。Effort は S=0.5 / S=1 / S-M=1.5 / M=2。

| 順 | NN | PBI | 種別 | R | I | C | E | RICE |
|---|---|---|---|---:|---:|---:|---:|---:|
| 1 | 01 | [2026-10-07-01-fix-search-columns-drift.md](2026-10-07-01-fix-search-columns-drift.md) | fix | 4 | 3 | 1.0 | 1 | 12.0 |
| 2 | 02 | [2026-10-07-02-fix-opfs-worker-callworker-bypass.md](2026-10-07-02-fix-opfs-worker-callworker-bypass.md) | fix | 5 | 3 | 1.0 | 1.5 | 10.0 |
| 3 | 03 | [2026-10-07-03-fix-review-summary-marker-asymmetry.md](2026-10-07-03-fix-review-summary-marker-asymmetry.md) | fix | 3 | 3 | 1.0 | 1 | 9.0 |
| 4 | 04 | [2026-10-07-04-fix-trustchecker-alert-keys-migration.md](2026-10-07-04-fix-trustchecker-alert-keys-migration.md) | fix | 4 | 3 | 1.0 | 1.5 | 8.0 |
| 5 | 05 | [2026-10-07-05-fix-crud-update-drift-ssot.md](2026-10-07-05-fix-crud-update-drift-ssot.md) | fix | 4 | 3 | 1.0 | 2 | 6.0 |
| 6 | 06 | [2026-10-07-06-fix-sw-startup-bench-cold.md](2026-10-07-06-fix-sw-startup-bench-cold.md) | fix | 3 | 2 | 1.0 | 1 | 6.0 |
| 7 | 07 | [2026-10-07-07-investigate-tab-url-permission-decision.md](2026-10-07-07-investigate-tab-url-permission-decision.md) | investigate | 3 | 2 | 0.8 | 1 | 4.8 |
| 8 | 08 | [2026-10-07-08-refactor-tabcache-factory-deletion.md](2026-10-07-08-refactor-tabcache-factory-deletion.md) | refactor | 2 | 1 | 1.0 | 0.5 | 4.0 |
| 9 | 09 | [2026-10-07-09-refactor-sessionalarm-injectable-sleep.md](2026-10-07-09-refactor-sessionalarm-injectable-sleep.md) | refactor | 3 | 1 | 1.0 | 1 | 3.0 |
| 10 | 10 | [2026-10-07-10-refactor-audit-log-codec.md](2026-10-07-10-refactor-audit-log-codec.md) | refactor | 3 | 1 | 1.0 | 1 | 3.0 |
| 11 | 11 | [2026-10-07-11-fix-masterpassword-selfverify-unify.md](2026-10-07-11-fix-masterpassword-selfverify-unify.md) | fix | 3 | 2 | 0.8 | 2 | 2.4 |
| 12 | 12 | [2026-10-07-12-test-dashboard-sqlite-subtype-asserts.md](2026-10-07-12-test-dashboard-sqlite-subtype-asserts.md) | test | 3 | 1 | 1.0 | 1.5 | 2.0 |
| 13 | 13 | [2026-10-07-13-refactor-popup-dom-scaffold-remainder.md](2026-10-07-13-refactor-popup-dom-scaffold-remainder.md) | refactor | 4 | 1 | 1.0 | 2 | 2.0 |
| 14 | 14 | [2026-10-07-14-refactor-getstatus-dead-count.md](2026-10-07-14-refactor-getstatus-dead-count.md) | refactor | 2 | 0.5 | 1.0 | 0.5 | 2.0 |
| 15 | 15 | [2026-10-07-15-refactor-f3-archive-source-import.md](2026-10-07-15-refactor-f3-archive-source-import.md) | refactor | 2 | 1 | 1.0 | 1 | 2.0 |
| 16 | 16 | [2026-10-07-16-refactor-provider-allowlist-subdomain.md](2026-10-07-16-refactor-provider-allowlist-subdomain.md) | refactor | 3 | 1 | 0.8 | 1.5 | 1.6 |
| 17 | 17 | [2026-10-07-17-refactor-aiusage-tracker-defaults-ssot.md](2026-10-07-17-refactor-aiusage-tracker-defaults-ssot.md) | refactor | 3 | 1 | 0.8 | 1.5 | 1.6 |

## 同点の順位根拠（tie-break）

- **6.0（NN05 と NN06）**: NN05 先行 — 同一 op 異結果のデータ乖離は計測の false confidence よりリスク軽減（リスク軽減→緊急性）
- **3.0（NN09 と NN10）**: 受領順（調査報告順）を維持。ファイル重複なし
- **2.0（NN12 / NN13 / NN14 / NN15 の 4-way）**: リスク軽減順 — trust boundary の fail-open（NN12）→ S6 継続テーマ（NN13）→ dead computation（NN14）→ bench 派生（NN15）
- **1.6（NN16 と NN17）**: NN16 先行 — CSP ゲートの規則はレート制限の既定値よりリスク軽減

## 純 RICE 順からの逸脱（1 件）

1. **NN10 → NN05 の後**（RICE 同点圏内）: audit_log codec（NN10）が `IdbVfsBackend.ts` を NN05（CRUD drift）と共有するため、編集競合回避で NN05 の着地後に実行する。

## 依存マップ（実行順の制約）

- **NN05 は NN01 の後に**（`IdbVfsBackend.ts` / `queryPlan.ts` の編集競合回避）
- **NN10 は NN05 の後に**（`IdbVfsBackend.ts` の編集競合回避）
- 上記以外は依存なし・並列可

## バッチ計画（B1–B5・ファイル排他）

| Wave | NN | 内容 |
|---|---|---|
| B1 | 01 / 02 / 03 / 04 | 依存なし 4 並列（rowCodec+queryPlan / OpfsWorkerBackend / reviewSummaryGenerator / trustChecker） |
| B2 | 05 / 06 / 07 / 08 | 05 は 01 着地後。06-08 は別領域 |
| B3 | 10 / 09 / 11 / 12 | 10 は 05 着地後。09/11/12 は別領域 |
| B4 | 13 / 14 / 15 / 16 | 別領域 4 並列 |
| B5 | 17 | 依存なし（統合側が直接実装） |

**共通ファイル（統合側がバッチ境界で 1 回だけ編集）**: `pbi/00-INDEX.md`、本台帳、`CHANGELOG.md`（版上げ時）。

## 台帳送り（見送り・次ラウンド予約）

| # | テーマ | RICE | 再検討トリガー |
|---|---|---|---|
| L1 | dashboard の `innerHTML = ''` clearing を clearElement seam に統一（13 箇所・trancoConsent:131 / tagsPanel:47,67,143 / domainFilterTagUI:78 / aiTestProgressView:24 / cleansingStatsView:262,364 / cspSettings:111 / cleansingFeedbackView:77 / models-dev-dialog:276,358。併せて `domainFilterTagUI.ts:173` の古い setTimeout(0) コメント修正） | 1.5 | 次に dashboard UI を触る時 |
| L2 | `src/offscreen/lruCache.ts` を shared へ移設し ManualContentFetcher（manualContentFetcher.ts:28-33,76-86）に採用。headerDetector の timestamp-scan LRU は語義が異なるため触らない | 1.33 | manualContentFetcher 改修時 |
| L3 | PermissionManager の denied-domain store 抽出（permissionManager.ts:154-344）+ RFC-1035 ドメイン検証 4 複製（trustDb/domainValidation.ts:14 / trancoUpdater.ts:167-169 / domainValidator.ts:12 / obsidianConfigValidator.ts:150-154）の共有 isValidDomain 統合 | 1.28 | permissionManager 改修時 |
| L4 | c6 bench の chrome.storage キー解決（c6-history-query.bench.mjs:22-49）と storageMock.ts（:28-62）の語義を runtime-agnostic helper に抽出 | 0.4 | 次に bench mock を触る時 |
| L5 | bench e2e one-off script の seam 重複（esbuild config / readiness wait / long-task observer ×2 / median ×2）の harness 寄せ | 0.27 | 次に e2e 計測 script を追加する時 |
| L6 | row の diagnostic metadata 述語（sqliteHistoryQuery.ts:66-68 vs historyEntryPresentation.ts:148-152、page_bytes 含む/含まない差）を 1 述語に統一 | Speculative | 診断フィールド追加時 |
| L7 | visitReporter のリトライ backoff（visitReporter.ts:150,245）を SleepFn 注入化 | Speculative | visitReporter のテスト追加時 |
| L8 | 同名ファイル `src/offscreen/archiveStaging.ts` と `src/offscreen/opfsWorker/archiveStaging.ts` の worker 側リネーム（例: stagingNameRegistry.ts） | Speculative | archive staging を触る時 |

- archloop-1006 の S1–S2（errorClassification / messageTransport の意図的層分離）は引き続き対象外。S3–S6 は本ラウンドの NN01/05/10/11/13/15/16 で消費済み。

## DoD 反映漏れ

- 本ラウンド開始時点の棚卸し: `pbi/` 直下の未完了はゲート付き/監視中/トリガー待ちのみ。実装コミットとの不一致なし。**0 件**。

## 5 Whys サマリー

- 「なぜ SEARCH_COLUMNS に plain 列が混入したのか」→ PBI-03 が list 投影用の 2 列を SEARCH_COLUMNS 経由で BROWSING_LOG_COLUMNS に広げた際、search 投影との境界が 1 リストに統合されたから。解: NN01
- 「なぜ mutation が callWorker を迂回したのか」→ counter 完全性の doc が後から付いたが、mutation 実装は doc 前の直接呼び出しのまま残ったから。解: NN02
- 「なぜマーカー読み書きが seam を跨いだのか」→ repo は当時 getMany/getAll までしか公開しておらず、set を使うには注入型を広げる必要があったから。解: NN03
- 「なぜ trustChecker が生 storage のまま残ったのか」→ SettingsRepository 統合の対象リストに trustChecker が入っていなかったから。解: NN04
- 「なぜ update の undefined 語義が分かれたのか」→ 2 バックエンドが並行に書かれ、同入力同結果の parametric pin が存在しなかったから。解: NN05
