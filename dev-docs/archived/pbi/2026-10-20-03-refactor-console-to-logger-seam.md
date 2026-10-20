# PBI 03: console 直呼びの logger seam 統一（約 44 箇所）

## ユーザーストーリー
メンテナーとして、本番コードの console 直呼びが logger seam に統一された状態がほしい、なぜなら console を迂回した失敗はログバッファに残らずマスキングも効かず、ERROR_CODES の集計から欠落するから。

## 変更点の概要
console.error/warn/log を logError/logWarn/logInfo（logger/core・api、offscreen では offscreenLogger LOG_FORWARD 経由）へ機械的に移行する。出力先が変わるだけで、呼び出し条件・エラーメッセージ内容は不変。

## 現状と問題
- dashboard: navTrailToggle.ts:51,75 / panelAction.ts:105 / generalSettingsPanel.ts:116,134 / diagnosticsActions.ts:121 / issueReportEntry.ts:72 / utils/retry.ts:70 / dashboard.ts:79,83,89（log）/ trancoConsent.ts:24,31 / tagsPanel.ts:226 / models-dev-dialog.ts:292,496
- popup: trancoNotification.ts:20,64,79,94
- utils: urlWhitelist.ts:42,45,93,98,119 / modelsDevApi.ts:109,114,119 / localeUtils.ts:23 / pathSanitizer.ts:192 / obsidianConfigBuilder.ts:85 / focusTrap.ts:177 / extractionReport.ts:472
- background: saveLocalMarkdownStep.ts:62,114 / recordingCache.ts:275
- offscreen: migrations.ts:97,111
- 共通: src/utils/errorClassification.ts:303（createErrorResponse 内）
- 対象外（明示コメント付きの意図的 console）: piiSanitizeHybrid.ts:97-106（e2e 回帰ガード）、issueReportLink.ts:202（開発者コンソール専用）

## 変更の理由
[可読性/副作用] 構造化ログ移行（ログ指摘 2026-10-15、asyncData パネルは void logError へ統一済み: asyncDataPanelLifecycle.ts:155 ほか）の残り半分。移行済みパターンの前例が既にコードベースにある。

## 提案コード（骨子）
現行: console.error('Failed to X', error)
統一後: void logError('Failed to X', { error: errorMessage(error) }, ErrorCode.X, 'モジュール名')

## BDD受け入れシナリオ
Scenario: 移行後も失敗が観測される
  Given ストレージ書き込みが失敗する
  When catch 経路が実行される
  Then 構造化ログに ErrorCode 付きで記録される（console 出力のみの状態から変わる）

Scenario: 意図的 console は残る
  Given e2e 回帰ガードの console.warn
  When 本 PBI の移行を実施する
  Then piiSanitizeHybrid.ts:97-106 と issueReportLink.ts:202 は変更されない

## 見積もり
2 pt（RICE: 58 = Reach 44 × Impact 2 × Confidence 1.0 ÷ Effort 1.5 人日）

## DoD
- [x] 移行対象 44 箇所で console 直呼びが 0 になる（対象外 2 箇所を除く）
- [x] 移行後の既存テスト全通過
- [x] npm run validate 通過

## 実装記録（2026-10-21）
- 移行 43 箇所 / 本番 24 ファイル（PBI 列挙 39 + Grep 全列挙の追加発見 4: hmacKeyStore.ts x3・entrypoints/background/index.ts x1）。dashboard/popup/utils/background は logError/logWarn/logInfo の canonical 形へ、offscreen migrations.ts は既存 seam forwardWarn（LOG_FORWARD 経由）へ
- ErrorCode は既存コードのみから選択（対応表: STORAGE_WRITE_FAILURE・INTERNAL_ERROR・API_REQUEST_FAILURE・INVALID_INPUT・MISSING_REQUIRED_FIELD・UNKNOWN_ERROR・API_AUTH_FAILURE・CRYPTO_HMAC_FAILURE。新規追加なし）
- 対象外 2 箇所（piiSanitizeHybrid の wasmHybridRuntime 出力点・issueReportLink.ts:202）は未変更を確認
- console pin を持つ 5 テストは seam モック assert へ置換（本 PBI が明示する出力先変更要件）+ mock 完全性修正 5 件
- 検証: フルスイート 1107 ファイル / 16581 テスト全通過、type-check exit 0、eslint exit 0、validate:fast green（684 ファイル / 10311 テスト）
