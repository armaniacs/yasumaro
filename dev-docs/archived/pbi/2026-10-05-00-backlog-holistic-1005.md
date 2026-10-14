# 2026-10-05 holistic ラウンド バックログ台帳（holistic-1005）

## 出所

- holistic-code-improvement skill による大局的レビューラウンド（6.9.36 時点）。
- 4 領域の地図用 agent（dashboard / popup+content / background+offscreen+messaging / shared infra）の並列発見をテーマ TOP に統合。
- 差分スコープ: 過去台帳（holistic-1003b・adversarial-1003・holistic-1001・archloop-1001・leftover-1002）で閉じたテーマは再レビュー対象外。進行中 PBI 11 件は全件ゲート付き/監視中/トリガー待ちのため候補に含めない（着手可能 0 件）。
- 実残 32 件を NN01–NN32 に起票。本台帳は RICE 採点・同点の順位根拠・依存・バッチ計画の SSOT。
- テーマの file:line はフェーズA 受領時に統合側が実測で裏取り済み。実装着手時は行番号がズレるため「関数名+概略位置」で読むこと。

## RICE 採点表（RICE 降順）

| 順 | NN | PBI | 種別 | R | I | C | E | RICE |
|---|---|---|---|---:|---:|---:|---:|---:|
| 1 | 01 | [2026-10-05-01-fix-validate-docs-ssot-gates.md](2026-10-05-01-fix-validate-docs-ssot-gates.md) | fix | 6 | 2 | 1.0 | 1 | 12.0 |
| 2 | 02 | [2026-10-05-02-fix-domain-policy-parity.md](2026-10-05-02-fix-domain-policy-parity.md) | fix | 7 | 3 | 1.0 | 2 | 10.5 |
| 3 | 03 | [2026-10-05-03-fix-test-sleep-lint-coverage.md](2026-10-05-03-fix-test-sleep-lint-coverage.md) | fix | 5 | 2 | 1.0 | 1 | 10.0 |
| 4 | 04 | [2026-10-05-04-fix-sessionstore-flush-lost-write.md](2026-10-05-04-fix-sessionstore-flush-lost-write.md) | fix | 6 | 3 | 1.0 | 2 | 9.0 |
| 5 | 05 | [2026-10-05-05-fix-unhandled-listener-rejections.md](2026-10-05-05-fix-unhandled-listener-rejections.md) | fix | 8 | 2 | 1.0 | 2 | 8.0 |
| 6 | 06 | [2026-10-05-06-refactor-loopback-ports-ssot.md](2026-10-05-06-refactor-loopback-ports-ssot.md) | refactor | 4 | 2 | 1.0 | 1 | 8.0 |
| 7 | 07 | [2026-10-05-07-fix-duplicate-field-ids-validation-split.md](2026-10-05-07-fix-duplicate-field-ids-validation-split.md) | fix | 5 | 3 | 1.0 | 2 | 7.5 |
| 8 | 08 | [2026-10-05-08-fix-privacy-dialog-settle.md](2026-10-05-08-fix-privacy-dialog-settle.md) | fix | 3 | 3 | 0.8 | 1 | 7.2 |
| 9 | 09 | [2026-10-05-09-refactor-main-status-single-path.md](2026-10-05-09-refactor-main-status-single-path.md) | refactor | 6 | 2 | 1.0 | 2 | 6.0 |
| 10 | 10 | [2026-10-05-10-fix-sensitive-mask-recursion-guard.md](2026-10-05-10-fix-sensitive-mask-recursion-guard.md) | fix | 3 | 2 | 1.0 | 1 | 6.0 |
| 11 | 12 | [2026-10-05-12-fix-local-md-alarm-ownership.md](2026-10-05-12-fix-local-md-alarm-ownership.md) | fix | 5 | 2 | 0.8 | 2 | 4.0 |
| 12 | 13 | [2026-10-05-13-refactor-envelope-shape-single-source.md](2026-10-05-13-refactor-envelope-shape-single-source.md) | refactor | 5 | 2 | 0.8 | 2 | 4.0 |
| 13 | 17 | [2026-10-05-17-refactor-status-top-mirror-owner.md](2026-10-05-17-refactor-status-top-mirror-owner.md) | refactor | 5 | 1 | 1.0 | 1 | 5.0 |
| 14 | 11 | [2026-10-05-11-fix-connection-test-button-guards.md](2026-10-05-11-fix-connection-test-button-guards.md) | fix | 4 | 2 | 1.0 | 2 | 4.0 |
| 15 | 14 | [2026-10-05-14-refactor-dashboard-gateway-runtime-timeout.md](2026-10-05-14-refactor-dashboard-gateway-runtime-timeout.md) | refactor | 4 | 1 | 1.0 | 1 | 4.0 |
| 16 | 15 | [2026-10-05-15-refactor-injectable-sleep-trust-retry.md](2026-10-05-15-refactor-injectable-sleep-trust-retry.md) | refactor | 4 | 1 | 1.0 | 1 | 4.0 |
| 17 | 16 | [2026-10-05-16-refactor-rate-limit-counter-read-merge.md](2026-10-05-16-refactor-rate-limit-counter-read-merge.md) | refactor | 4 | 1 | 1.0 | 1 | 4.0 |
| 18 | 26 | [2026-10-05-26-refactor-settings-repository-single-instance.md](2026-10-05-26-refactor-settings-repository-single-instance.md) | refactor | 5 | 2 | 0.8 | 2 | 4.0 |
| 19 | 22 | [2026-10-05-22-refactor-confirm-token-legacy-removal.md](2026-10-05-22-refactor-confirm-token-legacy-removal.md) | refactor | 4 | 2 | 0.8 | 2 | 3.2 |
| 20 | 18 | [2026-10-05-18-refactor-panel-destroy-contract.md](2026-10-05-18-refactor-panel-destroy-contract.md) | refactor | 4 | 2 | 0.8 | 2 | 3.2 |
| 21 | 27 | [2026-10-05-27-refactor-panel-catalog-id-union.md](2026-10-05-27-refactor-panel-catalog-id-union.md) | refactor | 3 | 1 | 1.0 | 1 | 3.0 |
| 22 | 23 | [2026-10-05-23-refactor-disconnect-phrase-ssot.md](2026-10-05-23-refactor-disconnect-phrase-ssot.md) | refactor | 3 | 1 | 1.0 | 1 | 3.0 |
| 23 | 21 | [2026-10-05-21-refactor-i18n-mock-single-factory.md](2026-10-05-21-refactor-i18n-mock-single-factory.md) | refactor | 6 | 1 | 0.9 | 2 | 2.7 |
| 24 | 20 | [2026-10-05-20-refactor-field-descriptor-unwired-seams.md](2026-10-05-20-refactor-field-descriptor-unwired-seams.md) | refactor | 3 | 1 | 0.8 | 1 | 2.4 |
| 25 | 28 | [2026-10-05-28-refactor-popup-test-dom-scaffold.md](2026-10-05-28-refactor-popup-test-dom-scaffold.md) | refactor | 5 | 1 | 0.9 | 2 | 2.25 |
| 26 | 19 | [2026-10-05-19-refactor-save-settings-pipeline-split.md](2026-10-05-19-refactor-save-settings-pipeline-split.md) | refactor | 5 | 1 | 0.8 | 2 | 2.0 |
| 27 | 25 | [2026-10-05-25-refactor-fetch-retry-residue.md](2026-10-05-25-refactor-fetch-retry-residue.md) | refactor | 5 | 1 | 0.8 | 2 | 2.0 |
| 28 | 24 | [2026-10-05-24-refactor-popup-e2e-fixture-unify.md](2026-10-05-24-refactor-popup-e2e-fixture-unify.md) | refactor | 3 | 1 | 1.0 | 1.5 | 2.0 |
| 29 | 30 | [2026-10-05-30-refactor-record-response-contract-ssot.md](2026-10-05-30-refactor-record-response-contract-ssot.md) | refactor | 4 | 1 | 0.8 | 2 | 1.6 |
| 30 | 31 | [2026-10-05-31-refactor-popup-init-single-entry.md](2026-10-05-31-refactor-popup-init-single-entry.md) | refactor | 4 | 1 | 0.8 | 2 | 1.6 |
| 31 | 32 | [2026-10-05-32-refactor-record-normal-branch-split.md](2026-10-05-32-refactor-record-normal-branch-split.md) | refactor | 4 | 1 | 0.8 | 2 | 1.6 |
| 32 | 29 | [2026-10-05-29-refactor-dashboard-dom-binding-convention.md](2026-10-05-29-refactor-dashboard-dom-binding-convention.md) | refactor | 4 | 1 | 1.0 | 3 | 1.33 |

RICE = R × I × C / E。Reach は 1 年間の保守作業での関与頻度（10=ほぼ毎週 / 5=月次 / 3=四半期 / 1=年次以下）。Effort は S=1 / S-M=1.5 / M=2 / L=3。

## 同点の順位根拠（tie-break）

- **8.0（05 と 06）**: NN05 先行 — Reach 大（8 vs 4）。入口の dynamic import 失敗はログすら残らない検出不能性が、ポート表の drift より先行する。
- **6.0（09 と 10）**: NN09 先行 — Reach 6 vs 3。status 経路は popup のほぼ全表示に波及する。
- **5.0（17）と 4.0 群**: 純 RICE では NN17(5.0) > NN11(4.0)。**依存で順序を逆転**（下記逸脱1）。表中は RICE 降順を維持し、実行順は W 計画が正。
- **4.0（11 / 12 / 13 / 14 / 15 / 16 / 26 の 7-way）**: 種別 fix > refactor → 実害有無 → Reach 降順。順: 11（並行ダウンロード成立・fix）→ 12（真夜中フック不成立・fix）→ 13（契約乖離・R5）→ 26（設定反映漏れ・R5）→ 14 / 15 / 16（R4・S 規模）。
- **3.2（18 と 22）**: NN22 先行 — リスク軽減効果。`providedToken === valid` の弱い比較が本番分岐に残る方が、destroy 到達不能（リークは漸進的）より先行。
- **3.0（23 と 27）**: NN27 先行 — 型ガード喪失は新規パネル追加時に発火し、切断文言コピーはパターン追加時のみ。
- **2.0（19 / 24 / 25）**: Reach 降順（19=5 → 25=5 → 24=3）。同 Reach の 19 と 25 は Confidence 同値のため 19 先行（保存パイプラインは他候補の解放に効く）。
- **1.6（30 / 31 / 32）**: NN32 は NN09 依存のため末端。30 → 31 → 32 の順で残す。

## 純 RICE 順からの逸脱（2 件）

1. **NN11 → NN17**（純 RICE では NN17(5.0) が NN11(4.0) より上）: 両者とも `src/dashboard/generalSettings/connectionTests.ts` を共有する順序依存。NN17 の改善案（mirror を `showStatus` 側へ移設）は NN11 で status 書き込みが1本化された後でないと移設先が定まらないため、NN11 を先行させる。
2. **NN22 → NN26**（純 RICE では NN26(4.0) が NN22(3.2) より上）: 両者とも `src/background/compositionManifest.ts` / `src/background/dashboardSqliteWiring.ts` を共有する順序依存。NN22 で `ensureConfirmToken` 依存を削除した後に NN26 が factory を差し替えると、不要になった依存の有無を1回で確定できる。

## 依存マップ（実行順の制約）

- **connectionTests チェーン（直列）**: 11 → 17 — 同一ファイル `connectionTests.ts`。
- **compositionManifest チェーン（直列）**: 22 → 26 — 同一ファイル。
- **messageTransport（直列）**: 13 → 23 — 同一ファイル `messageTransport.ts`。
- **settingsPipeline / fieldDescriptor チェーン（直列）**: 07 → 19、07 → 20 — `settingsPipeline.ts` と `fieldDescriptor.ts` を 07 が先行占有。
- **destroy 到達路**: 18 → 29 — 29 の新規約 `destroy()` が実際に生きるよう、18 で到達路を先に確定する。
- **popup status / テスト群**: 09 → 32、09 → 28 — `recordSession.ts` の経路競合と status class pin 更新。
- **i18n mock**: 21 → 28 — 同一の popup テストファイル群。21 の機械置換を先に行い、28 で DOM 脚手架だけを再構成する。
- **fieldDescriptor**: 07 → 20 — 同一ファイル。
- 上記以外（01 / 02 / 03 / 04 / 05 / 06 / 08 / 10 / 12 / 14 / 15 / 16 / 21 / 24 / 25 / 27 / 30 / 31）は依存なし・並列可。

## バッチ計画（W1–W7・ファイル排他）

| Wave | NN | 内容 |
|---|---|---|
| W1 | 01 / 02 / 03 / 04 / 05 / 06 | 依存なし 6 並列（01・03 は共通ファイルのため統合側が編集） |
| W2 | 07 / 08 / 09 / 10 | 07 が 19・20 を、09 が 32・28 を解錠 |
| W3 | 11 / 12 / 13 / 14 / 15 / 16 | 11 が 17 を、13 が 23 を解錠 |
| W4 | 17 / 18 / 19 / 20 / 21 | 18 が 29 を、21 が 28 を解錠 |
| W5 | 22 / 23 / 24 / 25 | 22 が 26 を解錠 |
| W6 | 26 / 27 / 28 / 29 | |
| W7 | 30 / 31 / 32 | 09 着地後の残り直列 |

**共通ファイル（統合側がバッチ境界で 1 回だけ編集）**: `package.json`（NN01）、`.github/workflows/ci.yml`（NN01）、`eslint.config.js` と `eslint/rules/*.mjs` の管轄文（NN03）、`pbi/00-INDEX.md`、本台帳、`CHANGELOG.md`。

## 実装状況

| NN | 状態 |
|---|---|
| 01–32 | ✅ 実装・アーカイブ済み（最終ゲート green） |

## 台帳送り（積み残し → 次ラウンド予約）

フェーズA の 4 領域レビューで、テーマ化するには出力が不足した・既知の再検討トリガーと重なるため除外した候補。**再検討トリガー付きで次ラウンドに送る。**

| # | テーマ | 出所 | 再検討トリガー |
|---|---|---|---|
| L1 | E2E / bench の仕様網羅評価（`testDir/e2e/**` のアサーション内容が全領域で未読） | 4 領域共通の走査範囲外 | 次ラウンドは e2e を独立領域として割り当てる |
| L2 | `src/background/pipeline/**`（17 ステップ）のエラー処理・retry 分類の重複。`pipeline/retryPolicy.ts` の `LEGACY_NETWORK_MARKERS` と他 retry 表の並存が未走査 | background 地図 積み残し | 次に recording パイプラインを触る時 |
| L3 | `src/offscreen/queryPlan.ts`（29KB）/ `queryPlanner.ts` / `searchExecution.ts`、`sqliteWireTable.ts`（37KB）/ `archiveWireTable.ts`（24KB）の行重複・`depsArgs`/`projectDeps` コピペ | background 地図 積み残し | 次に archive / query 契約を触る時 |
| L4 | `src/background/ai/**` の provider 応答メタデータ不揃い（`OpenAIProvider` は `failure` を付けるが `GeminiProvider` は付けない）。閉済テーマ「AI provider failure contract unify」の残りか未裁定 | background 地図 積み残し | 次に provider 応答契約を触る時 |
| L5 | dashboard の大型未深読みモジュール（sqliteHistoryPanelView 1018 行 / sqliteHistoryModel 845 / trustSettings 736 / aiSummaryCleansingSettingsV2 644 / customPromptManager 638 / masterPassword 476 / tagsPanel 475） | dashboard 地図 積み残し | 各モジュールの次回改修時 |
| L6 | message marker 表の 3 重（retryPredicate / failureTaxonomy / errorClassification）と HTTP リトライ表の 2 重（failureTaxonomy と obsidianClient.retryableStatusCodes） | shared infra 地図 補足候補 | 次に retry / failure 契約を触る時 |
| L7 | `diagnosticsPanel.ts` の `renderCompileOptions` が `${options.join('\n')}` を未エスケープで埋め込み（同一データを `makeStatRow` は textContent で描画）。単発のためテーマ化せず S 規模の fix 候補 | dashboard 地図 補足 | 診断パネルの次回改修時、または XSS 監査の再実施時 |
| L8 | `console.*` と `utils/logger` の二系統ログ（contentKernel / visitReporter / loader / trancoNotification / spinner に残存、logger 呼出は 53 箇所） | popup+content 地図 積み残し（empty-catch audit と主題重複のため除外） | `2026-09-22-01-backlog-empty-catch-audit.md` のトリガー発火時 |

## DoD 反映漏れ

- フェーズ0 の棚卸し結果: **0 件**。`pbi/` 直下の未完了 11 件はすべて INDEX にゲート付き / 監視中 / トリガー待ちとして記録済みで、実装コミットとチェックボックスの不一致は検出されなかった。
- INDEX の見出しドリフト 2 件（line 532「メタ認知 未着手 3 件」= 実体は全 4 件完了、line 585「バッチ 4 🔶」= バッチ 6 で解消）は、本ラウンドの docs コミットで修正する。

## 5 Whys サマリー（フェーズA で問いただした根本）

- 「なぜ docs の drift が残るのか」→ 照合スクリプトが存在するのにどの自動ゲートにも載っておらず、CI の path filter が .md 変更を差し引くため。解: NN01。
- 「なぜ content と SW でドメイン判定が逆逆転しうるのか」→ 分岐の SSOT（`domainUtils.isDomainAllowed`）が content 側に写されておらず、parity テストが SIMPLE/UBLOCK の 2 次元を固定値で除外しているため。解: NN02。
- 「なぜ `flushImmediately` が信用できないのか」→ in-flight flush 中の `set` を待たせるだけで何も書かず、finally の再スケジュールが `shouldRetry` 条件のみのため。解: NN04。
- 「なぜ未処理リジェクションが規則なく散るのか」→ エントリポイントの動的 import とリスナ登録に catch を強制する seam が存在しない（navTrail だけ `.catch` を書いた例外）。解: NN05。
- 「なぜ destroy が本番未到達なのにテストは緑なのか」→ `types.ts` の説明が実態と逆で、レジストリに destroy 呼び出しが 1 つも無いことを見つけるテストが無いため。解: NN18。
