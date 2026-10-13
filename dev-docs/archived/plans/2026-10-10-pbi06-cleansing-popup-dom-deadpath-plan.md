# PBI06 実装計画

## Objective
存在しない popup DOM id への dashboard 側参照と、それを支えるテスト fixture を削除する。

## Files Changed
- `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts`
- `src/dashboard/settings/__tests__/aiSummaryCleansingSettingsV2.test.ts`
- `src/dashboard/settings/__tests__/aiSummaryCleansingSettings-extra.test.ts`

## Validation
`npx vitest run src/dashboard/settings` — PASS（スコープ検証済み）。

## Rollback
削除した dead path と fixture を復元すればロールバックできる。
