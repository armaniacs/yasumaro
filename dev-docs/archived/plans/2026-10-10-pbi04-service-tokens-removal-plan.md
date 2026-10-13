# PBI04 実装計画

## Objective
廃止済みの `ServiceTokens` union を削除し、`ServiceKey` と設計仕様を一致させる。

## Files Changed
- `src/background/serviceContainer.ts`
- `src/background/__tests__/serviceContainer-coverage.test.ts`
- `DESIGN_SPECIFICATIONS.md`

## Validation
`npx vitest run src/background` — PASS（スコープ検証済み）。

## Rollback
`ServiceTokens` とテスト参照を復元すればロールバックできる。
