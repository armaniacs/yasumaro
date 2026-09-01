# PBI: BrowsingLogRepository の接続または削除 — dashboard SQLite アクセスの deep module 化を完遂 or 撤回

## ユーザーストーリー
開発者として、dashboard から SQLite への読み書き経路を一つに絞りたい。なぜなら現在 `src/dashboard/dashboardSqliteService.ts`（live、20 弱の shallow 関数 + `DashboardSqliteGateway` 委譲）と `src/dashboard/BrowsingLogRepository.ts`（未接続、296 行の deep module、consumer / test ゼロ）が並存し、`ServiceResult` / `isServiceError` が両方に重複定義されているから。

## 背景
`BrowsingLogRepository.ts` は PR #87（plan/0830 backlog execution）で「20 shallow 関数 → 1 seam」を狙って実装されたが、caller の移行が行われず未接続のまま残った。その後 PBI 2026-08-31-05（SQLite Gateway 統一）で `dashboardSqliteService.ts` 側が `DashboardSqliteGateway` 委譲にリファクタされ、`BrowsingLogRepository` はそのリファクタにも追従していない（独自の `sendDashboardMessage` を持つ）。

## 選択肢と判断（2026-09-01: 削除を採用）
1. **接続**: dashboard の query/search/toggleStar/delete/getCount/getStatus を `BrowsingLogRepository` に移し、`dashboardSqliteService` の該当関数を削除。`BrowsingLogRepository` を Gateway 委譲にリファクタ
2. **削除**（採用）: `BrowsingLogRepository.ts` を削除。`dashboardSqliteService.ts`（PBI 05 で Gateway 委譲済み）を唯一の経路に確定

**削除の根拠:**
- `dashboardSqliteService.ts` の 22 関数は `callDashboard(payload, decode, defaultMsg)` / `withRetry` の薄い委譲で、`callDashboard` は既に `dashboardGateway.callDashboard` へ委譲済み。実害（追加コスト / バグ）は出ていない
- `BrowsingLogRepository` はその 6 関数分しかカバーせず、しかも独自の `sendDashboardMessage` を持ち PBI 05 の Gateway リファクタに未追従。接続しても残り 16 関数は `dashboardSqliteService` に残り、統合にならない
- 既にアーカイブ済みの `dev-docs/archived/pbi/2026-08-27-18-feat-consolidate-dashboard-rpc.md` で「最小案（`withRetry` 抽出のみ）を採用」と決定済み。`BrowsingLogRepository` の去就は実質「廃止」だったがファイルが残っていた

## 受け入れ基準
- [x] `BrowsingLogRepository.ts` が削除される
- [x] `ServiceResult` / `isServiceError` の定義が 1 箇所のみ（`dashboardSqliteService.ts`。`sqliteHistoryQuery.ts` は re-export）
- [x] `dashboardSqliteService.ts` が唯一の dashboard SQLite 経路

## 見積もり
1 pt（削除）

## Definition of Done
- [x] `BrowsingLogRepository.ts` を削除
- [x] `npm run validate` が green（type-check / lint / test 11117 passed / build）
- [x] PBI 2026-08-27-18 の未達だった「去就決定」チェックを本 PBI で追認
