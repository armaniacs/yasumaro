# 2026-10-09 holistic-code-improvement ラウンド バックログ台帳（holistic-1009）

## 出所

- holistic-code-improvement skill によるコードベース全体（差分スコープ）の大局的レビュー。
- 4 系統の並列 explore agent 調査（dashboard+popup / background+offscreen / content+utils+layer / drift sweep+test infra）+ 統合側による graphify query と file:line 裏取り（サブエージェント報告の全 file:line は実読検証済み）。
- 差分スコープ: 過去台帳（holistic-1005 32件 / archloop-1006 23件 / archloop-1007 18件）で閉じたテーマは対象外。archloop-1007 台帳送り L1（dashboard innerHTML clearing）のトリガー「次に dashboard UI を触る時」が本ラウンドで発火したため NN15 として消費。L7（visitReporter SleepFn）はトリガー未発火のため台帳維持。
- レビュー報告書: 本台帳「レビュー報告書サマリー」節に要約。
- NN01–NN20 に起票（C18+C19 は同一ファイルクラスタのため NN03 に統合）。本台帳は RICE 採点・順位根拠・依存・バッチ計画の SSOT。

## RICE 採点表（RICE 降順）

RICE = R × I × C / E。Reach は保守関与頻度（5=月次以上 / 4=四半期に複数回 / 3=四半期 / 2=半年 / 1=年次以下）。Impact 3=実害解消 / 2=大きい / 1=中（重複削減・規範化）/ 0.5=小。Confidence 1.0=コードで確定 / 0.8=設計判断が残る。Effort は S=0.5 / S=1 / S-M=1.5 / M=2。

| 順 | NN | PBI | 種別 | R | I | C | E | RICE |
|---|---|---|---|---|---|---|---|---:|
| 1 | 01 | [2026-10-09-01-fix-archive-payload-validation-drift.md](2026-10-09-01-fix-archive-payload-validation-drift.md) | fix | 4 | 3 | 1.0 | 2 | 6.0 |
| 2 | 02 | [2026-10-09-02-refactor-settings-snapshot-honest-type.md](2026-10-09-02-refactor-settings-snapshot-honest-type.md) | refactor | 4 | 2 | 1.0 | 1.5 | 5.3 |
| 3 | 03 | [2026-10-09-03-fix-layer-ssot-gate-coverage.md](2026-10-09-03-fix-layer-ssot-gate-coverage.md) | fix | 5 | 2 | 1.0 | 2 | 5.0 |
| 4 | 04 | [2026-10-09-04-refactor-purge-sequence-ssot.md](2026-10-09-04-refactor-purge-sequence-ssot.md) | refactor | 4 | 2 | 1.0 | 2 | 4.0 |
| 5 | 05 | [2026-10-09-05-refactor-idb-scalar-read-helper.md](2026-10-09-05-refactor-idb-scalar-read-helper.md) | refactor | 4 | 1 | 1.0 | 1 | 4.0 |
| 6 | 06 | [2026-10-09-06-fix-cleansing-offscreen-wire-contract.md](2026-10-09-06-fix-cleansing-offscreen-wire-contract.md) | fix | 3 | 1 | 1.0 | 1 | 3.0 |
| 7 | 07 | [2026-10-09-07-refactor-cleansing-flag-prop-ssot.md](2026-10-09-07-refactor-cleansing-flag-prop-ssot.md) | refactor | 3 | 1 | 1.0 | 1 | 3.0 |
| 8 | 08 | [2026-10-09-08-refactor-content-kernel-e2e-state-publisher.md](2026-10-09-08-refactor-content-kernel-e2e-state-publisher.md) | refactor | 3 | 1 | 1.0 | 1 | 3.0 |
| 9 | 09 | [2026-10-09-09-refactor-maintenance-purge-twins.md](2026-10-09-09-refactor-maintenance-purge-twins.md) | refactor | 3 | 1 | 1.0 | 1 | 3.0 |
| 10 | 10 | [2026-10-09-10-refactor-popup-whitelist-button-wire.md](2026-10-09-10-refactor-popup-whitelist-button-wire.md) | refactor | 3 | 1 | 1.0 | 1 | 3.0 |
| 11 | 11 | [2026-10-09-11-refactor-opfs-worker-null-fold.md](2026-10-09-11-refactor-opfs-worker-null-fold.md) | refactor | 4 | 1 | 1.0 | 1.5 | 2.7 |
| 12 | 12 | [2026-10-09-12-refactor-b-priority-warning-single-path.md](2026-10-09-12-refactor-b-priority-warning-single-path.md) | refactor | 4 | 1 | 1.0 | 1.5 | 2.7 |
| 13 | 13 | [2026-10-09-13-test-dashboard-i18n-mock-factory-adoption.md](2026-10-09-13-test-dashboard-i18n-mock-factory-adoption.md) | test | 4 | 1 | 1.0 | 1.5 | 2.7 |
| 14 | 14 | [2026-10-09-14-refactor-asyncdata-table-builder-unify.md](2026-10-09-14-refactor-asyncdata-table-builder-unify.md) | refactor | 3 | 1 | 1.0 | 1.5 | 2.0 |
| 15 | 15 | [2026-10-09-15-refactor-clearelement-consolidation.md](2026-10-09-15-refactor-clearelement-consolidation.md) | refactor | 4 | 1 | 1.0 | 2 | 2.0 |
| 16 | 16 | [2026-10-09-16-refactor-scope-hash-utils-move.md](2026-10-09-16-refactor-scope-hash-utils-move.md) | refactor | 2 | 1 | 1.0 | 1 | 2.0 |
| 17 | 17 | [2026-10-09-17-refactor-tagcluster-query-cap-ssot.md](2026-10-09-17-refactor-tagcluster-query-cap-ssot.md) | refactor | 2 | 0.5 | 1.0 | 0.5 | 2.0 |
| 18 | 18 | [2026-10-09-18-chore-recording-gate-doc-claim.md](2026-10-09-18-chore-recording-gate-doc-claim.md) | chore | 2 | 0.5 | 1.0 | 0.5 | 2.0 |
| 19 | 19 | [2026-10-09-19-refactor-prompt-item-builder-ssot.md](2026-10-09-19-refactor-prompt-item-builder-ssot.md) | refactor | 3 | 1 | 1.0 | 2 | 1.5 |
| 20 | 20 | [2026-10-09-20-refactor-focus-cycle-helper.md](2026-10-09-20-refactor-focus-cycle-helper.md) | refactor | 2 | 1 | 0.8 | 1.5 | 1.1 |

## 同点の順位根拠（tie-break）

- **4.0（NN04 と NN05）**: NN04 先行 — 同一ファイル群（`IdbVfsBackend.ts`）の purge 統合が scalar ヘルパーの対象範囲を縮小する（purge 内の scalar 読み ~8 箇所が `runPurgeSequence` に吸収される）ため。
- **3.0（NN06/07/08/09/10 の 5-way）**: リスク軽減順 — wire 契約 silent drift（NN06）→ 設定値 silent 不整合（NN07）→ 型境界の嘘（NN08）→ purge twins（NN09）→ 文言 drift（NN10）。
- **2.7（NN11/12/13）**: backend drift リスク（NN11）→ UI 2実装+死蔵コード（NN12）→ test infra（NN13）。
- **2.0（NN14/15/16/17/18 の 5-way）**: NN15 を先頭 — dashboard UI を触る候補（NN12/13/14）の着地までに L1 台帳送りを消費する目的（受領順からの逸脱。理由記録済み）。以後 NN14 → NN16 → NN17 → NN18。

## 純 RICE 順からの逸脱（1 件）

1. **NN15 を 2.0 群の先頭へ**: L1（archloop-1007 台帳送り、dashboard innerHTML clearing 13 箇所）のトリガーが本ラウンドの dashboard UI 候補で発火しており、dashboard UI 改修が続く間に消費する方が台帳運用として筋が良い。

## 依存マップ（実行順の制約）

- **NN05 は NN04 の後に**（`IdbVfsBackend.ts` の編集競合回避）
- **NN08 は NN02 の後に**（`contentKernel.ts` の編集競合回避）
- 上記以外は依存なし・並列可

## バッチ計画（W1–W5・ファイル排他・同一ディレクトリ戦略）

| Wave | NN | 内容 |
|---|---|---|
| W1 | 01 / 02 / 03 / 12 | 依存なし 4 並列（validators+archiveWireTable / settingsSnapshot+contentKernel コメント / LAYERS+eslint rules / priorityListView+settingsPipeline） |
| W2 | 04 / 06 / 07 / 10 | 04 は 01 着地後も依存なし（ファイル非重複）。06-07-10 は別領域 |
| W3 | 05 / 08 / 09 / 11 | 05 は 04 着地後。08 は 02 着地後。09/11 は別領域 |
| W4 | 13 / 14 / 15 / 17 | 別領域 4 並列 |
| W5 | 16 / 19 / 20 / 18 | 18 は統合側が直接実装 |

**共通ファイル（統合側がバッチ境界で 1 回だけ編集）**: `pbi/00-INDEX.md`、本台帳。W4/W5 境界で新規 utils ファイル（NN15 の `clearElement` 移設先・NN16 の `computeScopeHash` 移設先）を LAYERS.md / eslint ルールリストに登録（NN03 のゲートが新規ファイルを追跡するため）。

## 台帳送り（見送り・トリガー管理）

| # | テーマ | 再検討トリガー |
|---|---|---|
| F1 | tagsPanel の保存フィードバックが panel-export-import の非表示ステータス要素に書かれる（`tagsPanel.ts:219-227`、成功もエラーも panel-tags 表示中は不可視）。修正は panel-tags への専用ステータス要素追加（表示位置の変更）を伴う | 製品判断（表示位置の変更をユーザーが承認した時） |
| F2 | visitReporter のリトライ backoff を SleepFn 注入化（archloop-1007 L7 と同一。トリガー未発火のため台帳維持） | visitReporter のテスト追加時 |
| F3 | urlSkipper の production 未使用 shim（2-arg `isDomainInList` は `matchSubdomains` を黙って落とす。`urlSkipper.ts:48-50,58-59`） | 次に urlSkipper を触る時 |
| F4 | statusChecker のスキップ判定手書き再実装（`statusChecker.ts:115` は SKIPPED_PROTOCOLS 部分集合。canonical は src/content のため逆辺） | 次に popup 起動判定を触る時 |
| F5 | domainFilterCache の production 未使用 `getDomainFilterCacheSync` が mode 既定値を割って複製（`:37` blacklist vs `domainPolicyPort.ts:56` disabled） | 次に domain filter cache を触る時 |
| F6 | appConstants の死定数（`STATUS_COLORS`・`TIMEOUTS`、production 未 import） | 次に constants を触る時 |
| F7 | confirmTokenManager の id 比較二重チェック（内側条件は常に偽の死に複雑度。`confirmTokenManager.ts:155-160`） | 次に confirm token を触る時 |
| F8 | dashboardSqliteProtocol の 6 subtype が `confirmToken?` 未宣言（create/export/restore/delete_by_staging は宣言あり）+ `create_confirm_token` の `scopeHash` 未宣言 | 次に sqlite protocol を触る時 |
| F9 | trancoNotification の console 直書き（pbi-1006-20 logger 統一の漏れ。`:20,64,79,94`） | 次に tranco notification を触る時 |
| F10 | vitest.config.ts:87 の coverage exclude が削除済み BrowsingLogRepository.ts を参照 | 次に coverage 設定を触る時 |
| F11 | LAYERS.md Layer 0 表の重複収載（`failureTaxonomy.ts`/`vfsCapabilities.ts` が 2 回ずつ） | 次に LAYERS.md を触る時（NN03 で近接するが別検査） |
| F12 | scripts 間の `function* walk()` ツリーウォーク複製（check-innerhtml-escape.mjs:21-32 / check-deprecated-aliases.mjs:44-55） | 次に SSOT ゲート script を追加する時 |
| F13 | generalSettingsPanel の mount 内 `reload-general-settings` listener に destroy 解放なし（NavigationRegistry の mount-once で bounded のため増殖はしない） | panel lifecycle 契約変更時 |
| F14 | cleansingStatsView の日本語リテラルが t()/data-i18n を経由しない（`:326,349,378`） | i18n カバレッジ改善時 |
| F15 | models-dev-dialog の `.tab-btn` wiring が document スコープ（現状はクラス衝突なしで安全。`:232,303`） | 次に dialog を触る時 |
| F16 | trustSettings が dom マップを無視して `document.getElementById` 直クエリ（`:587,642`） | 次に trust settings を触る時 |
| F17 | exportLogsPanel の `limit: 100000` リテラル（AUDIT_CAP_IDB が SSOT。パネル自身が backend cap 差をガード済み） | 次に export logs panel を触る時 |
| F18 | settingsForm の優先度 select 6 ID が PRIORITY_SELECT_IDS と 2 重管理（`:29-34,58-63`） | 次に provider priority UI を触る時 |
| F19 | connectionTests の syncStatusToTop 冗長呼び出し（idempotent で防御的。10 箇所） | 次に connection tests を触る時 |
| F20 | privatePageDialog の 6 wireOnce ブロックが「close + trap 解放」プレフィックスを手書き（`:146-231`） | 次に private page dialog を触る時 |
| F21 | sqliteHistoryPanel の `_isMounted` が書き込みのみで読み取りゼロ（`:94,449,483`） | 次に sqlite history panel を触る時 |
| F22 | SCREEN_STATES.SETTINGS が本番到達不能（`screenState.ts:8-11` / `navigation.ts:29`） | 製品判断（settings 画面復活時） |
| F23 | quota.ts `getStorageUsage` が storagePort と同一 feature-detect を Layer 1 内に 2 実装（`:16-25`） | 次に quota を触る時 |
| F24 | `StoragePort` 同名異形（`utils/ports.ts:27-30` vs `utils/storage/storagePort.ts:18-29`） | 次に port 型を触る時 |

- archloop-1007 の L2–L8（lruCache 移設 / PermissionManager+RFC-1035 検証統合 / bench storage-key / bench e2e seams / diagnostic 述語 / archiveStaging 同名）はトリガー未発火のため台帳維持。
- backlog-future 統合台帳のトリガー駆動項目はトリガー未発火で維持（差分レビュー済み）。

## DoD 反映漏れ

- 本ラウンド開始時点の棚卸し: `pbi/` 直下の未完了 10 件はゲート付き/監視中/トリガー待ちのみ。実装コミットとの不一致なし。**0 件**。

## レビュー報告書サマリー（4 観点）

- **強み**: panels 基盤は型レベルでカタログ整合強制・wire table/codec 群は sync assert + parity 完備・テスト基盤（type baseline ゲートの tsc-ran sanity）は構造的に堅牢・暗号/KDF/エンベロープ境界は fail-closed。
- **主な構造的課題**: (1) オフスクリーン SQLite バックエンド層に parity pin のない構造的重複（purge 4 重・scalar ×16・null-fold ×17） (2) 境界型が「嘘の型 + 二重キャスト」で契約を隠す（settingsSnapshot / cleansingOffscreenDelegate / アーカイブ payload 検査の厳格さ drift） (3) ラウンドで新設した SSOT ゲート自体の管轄穴（@layer 未収載・filesystem 照合欠落） (4) dashboard/popup UI の共通化残骸。

## 5 Whys サマリー（主要テーマ）

- 「なぜ purge が 4 重に並んだのか」→ IDB/OPFS 2 バックエンドが並行実装され、バックエンド層の parity pin（メッセージ層のみ実在）が backend 実装を覆っていなかったから。解: NN04
- 「なぜ settingsSnapshot が嘘型を返すのか」→ 検証省略の Record を `as Settings` で返す経路が正、と消費者側が二重キャストで追従してしまったから。解: NN02
- 「なぜ @layer 宣言が SSOT 外に増えたのか」→ 配置チェックリストが「@layer コメント付与」のみを要求し、LAYER0_FILES/LAYERS.md への追加ステップが無かったから。解: NN03
- 「なぜアーカイブ payload 検査が 2 実装に割れたのか」→ validators と wire table が別ラウンドで別々に作られ、共有チェックの抽出と parity pin が実施されなかったから。解: NN01
- 「なぜ i18n モックのコピーが dashboard 側に残ったのか」→ pbi-1005-21 の統一が popup 側を先に進め、dashboard 側 5 ファイルが対象リストから漏れたから。解: NN13
