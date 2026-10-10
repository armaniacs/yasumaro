# PBI05 実装計画

## Objective
dashboard のユーザー向け文言を `getMessageOr` 契約へ統一し、監査ログ上限を SSOT 参照へ移行する。

## Files Changed
- `src/dashboard/panels/diagnostic/exportLogsPanel.ts`
- `src/dashboard/cleansingFeedbackView.ts`
- `src/dashboard/cleansingStatsView.ts`
- `src/dashboard/settings/customPromptManager.ts`
- `src/dashboard/encryptedBackupPanel.ts`
- `src/dashboard/gistSettings.ts`
- `src/dashboard/trancoConsent.ts`
- `src/dashboard/localMarkdownExport.ts`
- `_locales/ja/messages.json`
- `_locales/en/messages.json`

## Validation
`npx vitest run src/dashboard` — PASS（スコープ検証済み）。

## Rollback
i18n 呼び出しとメッセージキーを戻せばロールバックできる。
