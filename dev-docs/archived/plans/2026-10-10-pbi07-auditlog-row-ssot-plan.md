# PBI07 実装計画

## Objective
監査ログ行形状を `src/utils/sqlite-types.ts` の単一所有へ統合する。

## Files Changed
- `src/utils/sqlite-types.ts`
- `src/messaging/sqliteRpcClient.ts`
- `src/messaging/sqliteValidators.ts`
- `src/messaging/auditLogGateway.ts`
- `src/messaging/dashboardSqliteProtocol.ts`
- `src/background/handlers/dashboardSqlite/deps.ts`
- `src/dashboard/dashboardSqliteService.ts`
- `src/dashboard/utils/auditLogTsv.ts`

## Validation
`npm run type-check` と監査ログ系テスト — PASS（スコープ検証済み）。

## Rollback
各消費者の型 import を元の宣言へ戻せばロールバックできる。
