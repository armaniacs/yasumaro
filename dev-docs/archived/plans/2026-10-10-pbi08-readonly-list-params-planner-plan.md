# PBI08 実装計画

## Objective
readOnlyHandler の list params のデフォルト所有を offscreen planner seam に集約する。

## Files Changed
- `src/background/handlers/dashboardSqlite/readOnlyHandler.ts`
- `src/background/handlers/dashboardSqlite/__tests__/`

## Validation
`npx vitest run src/background/handlers/dashboardSqlite src/offscreen` — PASS（スコープ検証済み）。

## Rollback
list params の `pickDefined` 置換を戻せばロールバックできる。
