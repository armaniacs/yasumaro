# PBI: BrowsingLogRepository の接続または削除 — dashboard SQLite アクセスの deep module 化を完遂 or 撤回

## ユーザーストーリー
開発者として、dashboard から SQLite への読み書き経路を一つに絞りたい。なぜなら現在 `src/dashboard/dashboardSqliteService.ts`（live、20 弱の shallow 関数 + `DashboardSqliteGateway` 委譲）と `src/dashboard/BrowsingLogRepository.ts`（未接続、296 行の deep module、consumer / test ゼロ）が並存し、`ServiceResult` / `isServiceError` が両方に重複定義されているから。

## 背景
`BrowsingLogRepository.ts` は PR #87（plan/0830 backlog execution）で「20 shallow 関数 → 1 seam」を狙って実装されたが、caller の移行が行われず未接続のまま残った。その後 PBI 2026-08-31-05（SQLite Gateway 統一）で `dashboardSqliteService.ts` 側が `DashboardSqliteGateway` 委譲にリファクタされ、`BrowsingLogRepository` はそのリファクタにも追従していない（独自の `sendDashboardMessage` を持つ）。

## 選択肢
1. **接続**: PR #87 の当初意図どおり、dashboard の query/search/toggleStar/delete/getCount/getStatus 呼出しを `BrowsingLogRepository` に移し、`dashboardSqliteService` の該当 shallow 関数を削除。`BrowsingLogRepository` を Gateway 委譲にリファクタして PBI 05 と整合させる
2. **削除**: `BrowsingLogRepository.ts` を削除。`dashboardSqliteService.ts`（Gateway 委譲済み）を唯一の経路として確定

判断材料: `dashboardSqliteService.ts` の shallow 関数群が現時点で実害（追加コスト / バグ）を出しているか。出していなければ削除（YAGNI）、出しているなら接続。

## 受け入れ基準
- [ ] `BrowsingLogRepository.ts` が削除される、または全 dashboard SQLite 呼出しの唯一の経路になる
- [ ] `ServiceResult` / `isServiceError` の定義が 1 箇所のみ
- [ ] `dashboardSqliteService.ts` と `BrowsingLogRepository.ts` が同時に存在しない

## 見積もり
- 削除の場合: 1 pt
- 接続の場合: 3 pt（caller 移行 + Gateway 整合 + テスト追加）

## Definition of Done
- [ ] 上記いずれかが完了
- [ ] `npm run validate` が green
- [ ] DESIGN_SPECIFICATIONS.md §5.4 の記述と実装が一致
