# PBI09 実装計画

## Objective
per-site override の status 表示を `showStatus` と NN05 の i18n キーへ統一し、タイマー競合を解消する。

## Files Changed
- `src/dashboard/settings/perSiteOverrides.ts`
- `src/dashboard/settings/__tests__/`

## Validation
`npx vitest run src/dashboard` — PASS（スコープ検証済み）。

## Rollback
status 呼び出しとテストの置換を戻せばロールバックできる。
