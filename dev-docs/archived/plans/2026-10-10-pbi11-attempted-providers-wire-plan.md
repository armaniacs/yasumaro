# PBI11 実装計画

## Objective
`providersTried` を廃止し、試行プロバイダー一覧の wire 契約を `attemptedProviders` に統一する。

## Files Changed
- `src/messaging/types.ts`
- `src/background/handlers/recordingHandlers.ts`
- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`
- 関連テスト

## Validation
`npm run type-check` と dashboard/background テスト — PASS（スコープ検証済み）。

## Rollback
wire 型・adapter・dashboard 読み取りを元に戻せばロールバックできる。
