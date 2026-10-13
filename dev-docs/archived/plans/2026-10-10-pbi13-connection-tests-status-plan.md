# PBI13 実装計画

## Objective
connectionTests の status 書き込みを `showStatus` 契約へ統一し、冗長なミラー呼び出しを除去する。

## Files Changed
- `src/dashboard/generalSettings/connectionTests.ts`
- `src/dashboard/generalSettings/__tests__/connectionTests*.test.ts`

## Validation
`npx vitest run src/dashboard` — PASS（スコープ検証済み）。

## Rollback
status ブロックとテストの置換を戻せばロールバックできる。
