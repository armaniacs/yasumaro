# PBI12 実装計画

## Objective
未使用の `detectOpfsCapabilitiesForResolver` と stale comment、専用 coverage describe を削除する。

## Files Changed
- `src/offscreen/backendResolver.ts`
- `src/offscreen/__tests__/backendResolver-coverage.test.ts`

## Validation
`npx vitest run src/offscreen` — PASS（スコープ検証済み）。

## Rollback
削除したラッパーとテスト describe を復元すればロールバックできる。
