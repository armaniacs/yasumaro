# 2026-10-06 arch-delivery-loop ラウンド バックログ台帳（archloop-1006）

## 出所

- arch-delivery-loop の closed loop（診断→PBI化→自律実装→検証→版上げ）を、holistic-1005 の台帳送り L1–L8 に対して実行するラウンド。スキル本体（`.kilo/skills/arch-delivery-loop/SKILL.md`）不在のため、holistic-code-improvement と同等の手順で閉じる。
- 4 テーマ群の調査を並列 agent（e2e / retry-failure / offscreen-ai / dashboard）に委譲し、L8（console→logger）は統合側が直査。すべての指摘は file:line 実測で裏取り済み。
- 差分スコープ: 過去台帳で閉じたテーマ（popup fixture 統一、no-test-sleep カバレッジ、envelope/disconnect SSOT、fetch backoff・残渣、panel 各種分割、failure contract unify 等）は再レビュー対象外。
- NN01–NN23 に起票。本台帳は RICE 採点・順位根拠・依存・バッチ計画の SSOT。
- file:line は受領時に統合側が実測で裏取り済み。実装着手時は行番号ズレに注意し「関数名+概略位置」で読むこと。

## RICE 採点表（RICE 降順）

| 順 | NN | PBI | 種別 | R | I | C | E | RICE |
|---|---|---|---|---:|---:|---:|---:|---:|
| 1 | 01 | [2026-10-06-01-fix-diagnostics-compile-options-escape.md](2026-10-06-01-fix-diagnostics-compile-options-escape.md) | fix | 3 | 3 | 1.0 | 1 | 9.0 |
| 2 | 02 | [2026-10-06-02-fix-gemini-empty-failure.md](2026-10-06-02-fix-gemini-empty-failure.md) | fix | 4 | 2 | 1.0 | 1 | 8.0 |
| 3 | 03 | [2026-10-06-03-fix-e2e-poll-shared-seed.md](2026-10-06-03-fix-e2e-poll-shared-seed.md) | fix | 3 | 2 | 1.0 | 1 | 6.0 |
| 4 | 04 | [2026-10-06-04-refactor-queryplan-tag-params.md](2026-10-06-04-refactor-queryplan-tag-params.md) | refactor | 4 | 2 | 0.8 | 1.5 | 4.27 |
| 5 | 05 | [2026-10-06-05-refactor-step-failure-helix.md](2026-10-06-05-refactor-step-failure-helix.md) | refactor | 4 | 1 | 1.0 | 1 | 4.0 |
| 6 | 06 | [2026-10-06-06-refactor-step-self-catch.md](2026-10-06-06-refactor-step-self-catch.md) | refactor | 5 | 2 | 0.8 | 2 | 4.0 |
| 7 | 07 | [2026-10-06-07-refactor-boundary-guards.md](2026-10-06-07-refactor-boundary-guards.md) | refactor | 3 | 1 | 0.9 | 1 | 3.6 |
| 8 | 08 | [2026-10-06-08-test-e2e-skipped-paths.md](2026-10-06-08-test-e2e-skipped-paths.md) | test | 4 | 2 | 0.8 | 2 | 3.2 |
| 9 | 09 | [2026-10-06-09-refactor-obsidian-retry-table.md](2026-10-06-09-refactor-obsidian-retry-table.md) | refactor | 3 | 1 | 1.0 | 1 | 3.0 |
| 10 | 10 | [2026-10-06-10-refactor-archive-wire-args.md](2026-10-06-10-refactor-archive-wire-args.md) | refactor | 3 | 1 | 1.0 | 1 | 3.0 |
| 11 | 11 | [2026-10-06-11-refactor-sqlite-decode-twins.md](2026-10-06-11-refactor-sqlite-decode-twins.md) | refactor | 3 | 1 | 1.0 | 1 | 3.0 |
| 12 | 12 | [2026-10-06-12-refactor-masterpassword-modal.md](2026-10-06-12-refactor-masterpassword-modal.md) | refactor | 3 | 1 | 1.0 | 1 | 3.0 |
| 13 | 13 | [2026-10-06-13-refactor-bench-launcher.md](2026-10-06-13-refactor-bench-launcher.md) | refactor | 4 | 1 | 0.8 | 1 | 2.4 |
| 14 | 14 | [2026-10-06-14-refactor-dashboard-fixture.md](2026-10-06-14-refactor-dashboard-fixture.md) | refactor | 4 | 1 | 0.9 | 2 | 1.8 |
| 15 | 15 | [2026-10-06-15-refactor-compat-markers.md](2026-10-06-15-refactor-compat-markers.md) | refactor | 4 | 1 | 0.8 | 2 | 1.6 |
| 16 | 17 | [2026-10-06-17-refactor-wire-lambda-consts.md](2026-10-06-17-refactor-wire-lambda-consts.md) | refactor | 3 | 0.5 | 1.0 | 1 | 1.5 |
| 17 | 16 | [2026-10-06-16-refactor-tag-chip-factory.md](2026-10-06-16-refactor-tag-chip-factory.md) | refactor | 4 | 1 | 0.8 | 2 | 1.6 |
| 18 | 18 | [2026-10-06-18-refactor-history-model-mutation.md](2026-10-06-18-refactor-history-model-mutation.md) | refactor | 4 | 1 | 0.8 | 2 | 1.6 |
| 19 | 21 | [2026-10-06-21-refactor-prompt-list-wiring.md](2026-10-06-21-refactor-prompt-list-wiring.md) | refactor | 4 | 1 | 0.8 | 2 | 1.6 |
| 20 | 19 | [2026-10-06-19-refactor-crud-archive-skeleton.md](2026-10-06-19-refactor-crud-archive-skeleton.md) | refactor | 4 | 1 | 0.8 | 2 | 1.6 |
| 21 | 20 | [2026-10-06-20-refactor-content-logger-unify.md](2026-10-06-20-refactor-content-logger-unify.md) | refactor | 3 | 0.5 | 1.0 | 1 | 1.5 |
| 22 | 22 | [2026-10-06-22-test-diagnostics-assert-dedup.md](2026-10-06-22-test-diagnostics-assert-dedup.md) | test | 3 | 1 | 0.9 | 2 | 1.35 |
| 23 | 23 | [2026-10-06-23-test-search-tag-dedup.md](2026-10-06-23-test-search-tag-dedup.md) | test | 3 | 1 | 0.8 | 2 | 1.2 |

RICE = R × I × C / E。Reach は保守関与頻度（10=毎週 / 5=月次 / 3=四半期 / 1=年次以下）。Impact 3=実害解消。Effort は S=1 / S-M=1.5 / M=2。

## 同点の順位根拠（tie-break）

- **4.0（05 と 06）**: NN05 先行 — Effort 小（1 vs 2）。ともに pipeline 層だが依存なし
- **3.0（09 / 10 / 11 / 12 の 4-way）**: 同点のため受領順（調査報告順）を維持。ファイル重なりなし
- **1.6（15 / 16 / 18 / 19 / 21 の 5-way）**: 依存が順序を決める。16・18・19・21 はいずれも先行依存あり（下記）。15 は依存なしのため先行
- **1.5（17 と 20）**: NN17 先行 — SSOT 登録テーマのため

## 純 RICE 順からの逸脱（1 件）

1. **NN14 → NN13**（純 RICE では NN13 2.4 が NN14 1.8 より上）: bench の launcher 委譲先が単一 SSOT になってからでないと委譲先が定まらないため、NN14 を先行させる。

## 依存マップ（実行順の制約）

- **E5 → E1 系**: NN13 は NN14 の後に実行（委譲先の確定）
- **wire 表**: NN17 は NN11 の後に実行（同一ファイル `sqliteWireTable.ts` の編集競合回避）
- **handlers**: NN19 は NN10 の後に実行（差分が小さくなる）
- **trustSettings**: NN21 は NN16 の後に実行（同一ファイルの render 群）
- **historyModel**: NN18 は NN07 の後に実行（同一ファイル。NN07 のガードヘルパー確定後）
- 上記以外は依存なし・並列可

## バッチ計画（B1–B6・ファイル排他）

| Wave | NN | 内容 |
|---|---|---|
| B1 | 01 / 02 / 03 / 04 | 依存なし 4 並列 |
| B2 | 05 / 06 / 07 / 08 | 05・06 は pipeline 別ファイル、07・08 は別領域 |
| B3 | 09 / 10 / 11 / 12 | 別ファイル 4 並列。AI 要約系に独立リトライ表なしを統合側で事前確認済み（`HttpProviderStrategy.ts:233` が transport 述語単一決定を明記） |
| B4 | 14 / 13 / 15 / 16 | 14 が 13 を解錠。15・16 は別ファイル |
| B5 | 11着地後の 17 / 07着地後の 18 / 10着地後の 19 / 20 | 17・19 は先行着地待ち、18・20 は依存解消済み |
| B6 | 16着地後の 21 / 22 / 23 | 21 は 16 着地後。22・23 は E2E spec 整理 |

**共通ファイル（統合側がバッチ境界で 1 回だけ編集）**: `pbi/00-INDEX.md`、本台帳、`CHANGELOG.md`（版上げ時）。

## 実装状況

| NN | 状態 |
|---|---|
| 01–23 | ✅ 実装・アーカイブ済み（最終ゲート green） |

## 台帳送り（見送り・次ラウンド予約）

| # | テーマ | 出所 | 再検討トリガー |
|---|---|---|---|
| S1 | `errorClassification.ts` の表示分類は意図的層分離のため統合対象外 | L2/L6 調査の見送り裁定 | 表示語彙と retry 可否を同時に変える要求が出た時 |
| S2 | `messageTransport.ts` の chrome-transport 正規表現は別 universe のため対象外 | L2/L6 調査の見送り裁定 | MV3 配送とネットワーク到達性の語彙が交差した時 |
| S3 | bench/harness 単体テスト群・bench/micro・probe・test-pages・archiveDbReader の未読分 | L1 調査の積み残し | 次に bench 基盤を触る時 |
| S4 | `sqliteQueryBuilder` の二重条件源・`rowCodec` 列所有境界・`DASHBOARD_SERVICE_TABLE` decode 群の未読分 | L3 調査の積み残し | 次に query/codec 契約を触る時 |
| S5 | `sqliteHistoryQuery`・`dashboardSqliteService`・`cleansingPresetStore`・`permissionManager`・`providerAllowlist`・masterPassword 境界・cleansing god 分割の未精査分 | L5 調査の積み残し | 各モジュールの次回改修時 |
| S6 | popup テスト DOM 脚手架の残り 4 ファイル（statusPanel-cleansingFeedback / privacyConsentController ×2 / recordCurrentPage-extra の専用 DOM） | holistic-1005 NN28 の残余 | popup テスト基盤の次回改修時 |

## DoD 反映漏れ

- 本ラウンド開始時点の棚卸し: `pbi/` 直下の未完了はゲート付き/監視中/トリガー待ちのみで、実装コミットとの不一致なし。**0 件**。

## 5 Whys サマリー（フェーズA で問いただした根本）

- 「なぜ dashboard fixture が三重化したのか」→ popup の `createPopupFixture` 統一時に dashboard 系が対象外だったから。解: NN14
- 「なぜ poll が spec 内に再定義されたのか」→ 正規 `poll` の存在が発見されにくい場所にあったから。解: NN03（ついでに seed 非冪等も修正）
- 「なぜ envelope 形判定と retry 表がまたがるのか」→ transport 語彙・HTTP 語彙・表示語彙の 3 層が同一ファイル群に同居しているから。解: NN09・NN15（層ごとに SSOT 化し、意図的分離は残す）
- 「なぜ wire 表の行が複製されるのか」→ 行追加がコピペ駆動で、共通部を抜く seam がなかったから。解: NN10・NN11・NN17
- 「なぜ recordSession の `as` が残ったのか」→ NN30 のガード集約時に call site の 1 箇所が見落とされたから（レビューで検出済み・1006c で修正済み）。本ラウンドでは同種の見落としを parity テストで防ぐ
