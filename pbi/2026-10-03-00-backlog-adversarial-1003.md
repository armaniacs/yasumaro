# 2026-10-03 adversarial review バックログ台帳（adversarial-1003）

## 出所

- adversarial-code-review skill による `7edc8c6d..HEAD`（37 commits / 163 files）の差分レビュー。
- hacker + maintainer の 2 視点を 6 agents で発見し、独立検証（反証付き裏取り）で 5 findings を REFUTED: domainFilter disabled legs / domainFilterCache persist flip / parseInt NaN / withAtomic log rename / recoveryClaimStore sweep widening / autoClose default state / simplified mocks drift。REFUTED 分は起票対象外。
- 実残 15 件を PBI 01–15 に起票した。本台帳は RICE 採点・依存順・到達可能性証拠の SSOT。

## RICE 採点表（RICE 降順）

| 順 | PBI | 種別 | R | I | C | E | RICE |
|---|---|---|---|---|---|---|---:|
| 1 | [2026-10-03-01-fix-popup-save-silent-data-loss.md](2026-10-03-01-fix-popup-save-silent-data-loss.md) | fix | 6 | 3 | 1.0 | 0.5 | 36.0 |
| 2 | [2026-10-03-02-fix-review-summary-alarms-never-created.md](2026-10-03-02-fix-review-summary-alarms-never-created.md) | fix | 4 | 2 | 1.0 | 0.5 | 16.0 |
| 3 | [2026-10-03-03-fix-settings-cache-read-your-write.md](2026-10-03-03-fix-settings-cache-read-your-write.md) | fix | 7 | 2 | 0.9 | 1.0 | 12.6 |
| 4 | [2026-10-03-04-fix-loginfo-argument-swap.md](2026-10-03-04-fix-loginfo-argument-swap.md) | fix | 5 | 1 | 1.0 | 0.5 | 10.0 |
| 5 | [2026-10-03-05-fix-panelaction-onerror-rejection.md](2026-10-03-05-fix-panelaction-onerror-rejection.md) | fix | 5 | 1 | 1.0 | 0.5 | 10.0 |
| 6 | [2026-10-03-06-fix-provider-priority-b-throw-divergence.md](2026-10-03-06-fix-provider-priority-b-throw-divergence.md) | fix | 2 | 2 | 0.9 | 0.5 | 7.2 |
| 7 | [2026-10-03-07-chore-type-baseline-gate-reliability.md](2026-10-03-07-chore-type-baseline-gate-reliability.md) | chore | 2 | 2 | 1.0 | 1.0 | 4.0 |
| 8 | [2026-10-03-08-fix-archive-concurrent-exclusion.md](2026-10-03-08-fix-archive-concurrent-exclusion.md) | fix | 3 | 2 | 0.9 | 1.5 | 3.6 |
| 9 | [2026-10-03-09-fix-anchor-download-revoke-signal.md](2026-10-03-09-fix-anchor-download-revoke-signal.md) | fix | 3 | 0.5 | 0.9 | 0.5 | 2.7 |
| 10 | [2026-10-03-10-refactor-error-display-contract.md](2026-10-03-10-refactor-error-display-contract.md) | refactor | 5 | 0.5 | 0.9 | 1.0 | 2.25 |
| 11 | [2026-10-03-11-fix-bootstrapper-tab-panel-mismatch.md](2026-10-03-11-fix-bootstrapper-tab-panel-mismatch.md) | fix | 2 | 0.5 | 1.0 | 0.5 | 2.0 |
| 12 | [2026-10-03-12-fix-saved-url-timestamp-sort-guard.md](2026-10-03-12-fix-saved-url-timestamp-sort-guard.md) | fix | 2 | 0.5 | 0.8 | 0.5 | 1.6 |
| 13 | [2026-10-03-13-test-pin-behavior-over-implementation.md](2026-10-03-13-test-pin-behavior-over-implementation.md) | test | 1 | 1 | 0.9 | 1.0 | 0.9 |
| 14 | [2026-10-03-14-fix-recovery-claim-same-ms-guard.md](2026-10-03-14-fix-recovery-claim-same-ms-guard.md) | fix | 1 | 0.5 | 0.8 | 0.5 | 0.8 |
| 15 | [2026-10-03-15-chore-comment-docs-alignment.md](2026-10-03-15-chore-comment-docs-alignment.md) | chore | 1 | 0.25 | 1.0 | 0.5 | 0.5 |

RICE = R × I × C / E。値は各 PBI 内「優先度」セクションの記載に基づく。

## 依存（実行順の制約）

- **06 は 04 の完了後に着手** — 両方とも `src/dashboard/settingsPipeline.ts` を編集するため直列（04:149,230-234 → 06:147）。
- **10 は 01 の完了後に着手** — 両方とも `src/popup/pendingPages.ts` に触る（01:116-129 → 10:20）。
- **08 は 05 の完了後に着手** — `src/dashboard/panels/panelAction.ts` 共有の可能性（05:84-91 / 08:70-91）。
- 上記 3 組以外は相互にファイル非重複で並列可（02 / 03 / 07 / 09 / 11 / 12 / 13 / 14 / 15 は単独修正可能）。

## 到達可能性（reachability-verified evidence）

独立検証で file:line を確認済みの到達経路（詳細は各 PBI の「背景 (evidence, verified)」/「現状（証拠）」セクション）:

- 01: 手動保存フロー（btn-save-selected / btn-save-whitelist）から常に到達 — `src/popup/pendingPages.ts:116-125`（gateway `src/messaging/pendingRecordGateway.ts:75-84` は全失敗を `{success:false}` に正規化）
- 02: registry 経由のみのアラーム生成経路（grep 確認・全ユーザーで機能沈黙）— `src/background/alarmRegistry.ts:87-99`（`alarms.create` `:97,:99` が到達不能）
- 03: 設定の読み書きは全機能から呼ばれる頻出経路 — `src/utils/storage/SettingsRepository.ts:152`
- 04: 設定保存失敗時の info ログ — `src/dashboard/settingsPipeline.ts:149`
- 05: 25 個の呼び出し箇所を持つ共通経路 — `src/dashboard/panels/panelAction.ts:84-86`
- 06: B レイアウト有効時の保存フロー — `src/dashboard/providerPrioritySlots.ts:56-60` + `src/dashboard/settingsPipeline.ts:147`
- 07: CI 6 workflows 走査済み — `.github/workflows/ci.yml:133-148` + `scripts/check-type-test-baseline.mjs:53-56`
- 08: 診断パネルの restore フロー — `src/dashboard/panels/diagnostic/archivePanel.ts:49`（`panelAction.ts:70-91` に counter/guard なし）
- 09: ログ export の anchor-click 経路 — `src/dashboard/exportLogsService.ts:145,155`
- 10: popup の 3 失敗経路 — `src/popup/statusPanel.ts:130` / `src/popup/privatePageDialog.ts:130` / `src/popup/pendingPages.ts:20`
- 11: sidebar クリック経路 — `src/dashboard/panels/DashboardBootstrapper.ts:129`（対照: `start()` `:169-180` は逆順で不整合なし）
- 12: 手作り・移行データ混入時 — `src/utils/storage/savedUrlRepository.ts:38`（同一モジュール `:482` は防御済み）
- 13: wireOnce 回帰ピン — `src/popup/__tests__/statusPanel-wireOnce-parity.test.ts:184-196`
- 14: 復旧入口の同時刻同一オーナー取得 — `src/utils/recoveryClaimStore.ts:95`
- 15: bundle 6 件 — `src/utils/ublockParser/index.ts:232-234` / `src/dashboard/generalSettings/settingsForm.ts:193,:219` / `src/utils/storage/storageTransaction.ts:170,:180-196` / `src/background/service-worker.ts:45,:187` / `CHANGELOG.md:1192`

## 実装状況

| PBI | 状態 |
|---|---|
| 01 | ✅ 完了（2026-10-03）— result 駆動削除 + whitelist `{ok:false}` 報告。検証: validate exit 0 |
| 02 | ✅ 完了（2026-10-03）— `createJobs(deps)` ファクトリ + `settingsReader` 必須化。逸脱: クロージャキャプチャ解釈 |
| 03 | ✅ 完了（2026-10-03）— `writeEpoch` 版スタンプで read-your-write を閉鎖。逸脱: observe branch も epoch advance |
| 04 | ✅ 完了（2026-10-03）— 3 箇所の logInfo スロット入れ替え修正。逸脱: `trancoManager` 実パスは `utils/trustDb/`（移設済み）、スロット解釈を除きログ内容バイト同一。検証: validate exit 0 |
| 05 | ✅ 完了（2026-10-03）— onError の try/catch guard + console.error 記録。逸脱: purge-test characterization 更新（漏れ経路は設計上除去）。検証: validate exit 0・panels 304/304 |
| 06 | ✅ 完了（2026-10-03）— B-throw も propagate に統一（B-try/catch → A silent fallback 廃止、doc に A/B 両 throw を追記）。逸脱: stored fallback 分岐は不採用（propagate 統一で保存中断が上回る）。検証: validate exit 0・35/35 repeats=5 |
| 07 | ✅ 完了（2026-10-03）— tsc-ran sanity（exit-code 方式）+ CI validate job へ baseline 配線 + CHANGELOG 整合。逸脱: summary 行 sanity は tsc 6.0.3 で採用不可のため棄却、swap 限界を文書化。検証: baseline 489/489 PASS |
| 08 | ✅ 完了（2026-10-03）— restoreFileInput を busy スコープへ + `inFlightControls`（WeakSet）guard + confirm dialog を run 内へ移動（`abortPanelAction`）。検証: validate exit 0・panels 53 tests repeats=20 |
| 09 | ✅ 完了（2026-10-03）— anchor-click はシグナル不在のため 60s を WHY コメントで codify（3 箇所一貫 pin、ロジック変更なし）。検証: validate exit 0 |
| 10 | ✅ 完了（2026-10-03）— 失敗表示を `getUserErrorMessage` 派生に統一（privatePageDialog :112 不整合解消）+ `errorDisplayContract.test.ts`。逸脱: wireOnce-parity の chrome.i18n stub 7 行は本 PBI 帰属（残差分は 13）。検証: validate exit 0・popup sweep 903 |
| 11 | ✅ 完了（2026-10-03）— navigate 失敗時の `#rollbackActiveTab` + pre-click snapshot。逸脱: activeId guard（activation 後失敗はロールバックせず）、toast なし裁定。検証: validate exit 0・21/21 repeats=20 |
| 12 | ✅ 完了（2026-10-03）— timestamp 欠損の `(|| 0)` 正規化（comparator ×2 + cutoff + reader）。逸脱: reader 正規化は AC 4 の決定を超えた実装。検証: validate exit 0・74/74 |
| 13 | ✅ 完了（2026-10-03）— ソース正規表現ピンを attach 観測（EventTarget seam）へ置換、settle()/drain を waitForMock 完了シグナルへ置換、tripwire 文書化。逸脱: spy 型注釈に `| null`（testDir baseline 489 復帰）。検証: validate exit 0・24 tests repeats=20 |
| 14 | ✅ 完了（2026-10-03）— claim token 導入（`token` 一致判定へ置換）+ `sleep?` 注入オプション。逸脱: テスト側 `getMockImplementation()` cast（baseline ゲート対応）。検証: validate exit 0・17 tests repeats=20 |
| 15 | ✅ 完了（2026-10-03）— (a)-(e) コメント・デッド比較修正（(d) はガード不採用・契約コメント）。(f) CHANGELOG は rank-07 で解消済み。検証: validate exit 0 |
