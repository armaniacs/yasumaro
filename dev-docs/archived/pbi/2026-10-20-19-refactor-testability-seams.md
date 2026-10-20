# PBI 19: テスト容易性の整備（時間 seam 注入・canonical seam テスト）

## ユーザーストーリー
メンテナーとして、本番の待ちが注入可能で canonical seam にテストがある状態がほしい、なぜなら TEST_RULE.md は本番の待ちは SleepFn 等で注入可能にすることを求め、canonical seam の無テスト変更は全レンダラ横断のリグレッションを未検出で通すから。

## 変更点の概要
生 setTimeout・生 Date.now() を注入可能な seam へ置き換え、canonical seam（domClear・compareStrings）にテストを追加する。実行時挙動は不変。

## 現状と問題
- src/dashboard/panels/asyncData/dashboardGateway.ts:151-152 と src/dashboard/visitReporter.ts:252（生 setTimeout、useTimerClock で検証される前例がある）
- src/utils/storage/settingsMigration.ts:615-630（cleanupExpiredSettingsBackups が Date.now() 直読み、他の options.now と seam が不統一）
- src/dashboard/aiSummaryCleansingSettingsV2.ts:22-24（import 時の holdBusy 副作用）
- src/dashboard/panels/staticForm/privacySettingsPanel.ts:147（setTimeout(() => window.location.reload(), 2000) のマジックナンバー、dashboard 全体で location.reload はこの 1 箇所、注入不可）
- src/utils/domClear.ts:11（clearElement、AGENTS.md 指定の canonical seam、dashboard 24 ファイル + popup shim が使用、テストなし）
- src/utils/compareStrings.ts:6（dashboard 集計 5 モジュール共有のソート比較子、テストなし）

## 変更の理由
[テスト容易性] 生 setTimeout/Date.now() は実時間待ちを強制し TEST_RULE 方針と不整合。canonical seam の無テストは将来のサニタイズ政策変更を無防備にする。

## 提案コード（骨子）
- dashboardGateway / visitReporter: sleep/injectable delay option を付与（既定値は現行と同一）
- settingsMigration: options.now を受け取る（他ステップと同一 seam）
- privacySettingsPanel: 遅延を定数化し reload を注入可能に
- domClear / compareStrings: 単体テストを新設（clearElement は要素除去の境界ケース込み）

## BDD受け入れシナリオ
Scenario: 時間 seam の注入
  Given useTimerClock でテスト時間を制御する
  When dashboardGateway の delay 経路を通す
  Then 実時間を待たずに遅延後の状態遷移が検証される（本番の既定遅延は不変）

Scenario: canonical seam の境界
  Given 子要素とイベントリスナーを持つ要素
  When clearElement を通す
  Then 要素内容が除去され、要素自体は残る

## 見積もり
2 pt（RICE: 14 = Reach 7 × Impact 2 × Confidence 1.0 ÷ Effort 1.0 人日）

## DoD
- [x] 生 setTimeout / Date.now() が注入可能 seam になる
- [x] domClear・compareStrings の単体テストが通過
- [x] npm run validate 通過

## 実装記録（2026-10-21）
- 現在地訂正: dashboardGateway は src/messaging/、visitReporter は src/content/、aiSummaryCleansingSettingsV2 は src/dashboard/settings/、privacySettingsPanel は src/dashboard/panels/staticForm/ 配下
- 注入化 5 箇所: dashboardGateway の DashboardRetryOptions.sleep?: SleepFn、visitReporter の VisitReporterDeps.sleep?: SleepFn、settingsMigration の cleanupExpiredSettingsBackups(port, { now })、aiSummaryCleansingSettingsV2 の createDashboardPresetStore({ holdInitialRenderWindow })、privacySettingsPanel の DELETE_ALL_RELOAD_DELAY_MS 定数 + reload?: () => void（全て既定値は旧生呼び出しと同一・実行時挙動不変）
- 新規テスト: src/utils/__tests__/domClear.test.ts（jsdom 6 tests）と compareStrings.test.ts（node 10 tests）で canonical 契約を pin
- 検証: 担当モジュール全テスト green、npm test 全体 1110 ファイル / 16614 テスト green、type-check 通過（新規エラーゼロ）、validate:fast green
