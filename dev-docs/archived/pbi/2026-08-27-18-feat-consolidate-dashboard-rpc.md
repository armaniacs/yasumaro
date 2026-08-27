# PBI: Dashboard Sqlite RPC の SqliteRpc 統合

## ユーザーストーリー
開発者として、dashboard の `subtype` が5箇所で重複定義されている `SqliteRpc` を1つの `SqliteRpc` seam に統合したい、なぜなら新 `subtype` 追加で5ファイル編集が必要で、`callDashboard` の retry ループが `queryLogs`/`searchLogs` で重複しているから。

## 優先度
- 順位: 7 / 7
- RICEスコア: 120（Reach=30 / Impact=1 / Confidence=60% / Effort=0.30） — 再評価で Speculative のまま。20 subtype を3メソッドで包むとドメイン歪み。`dashboardSqliteService` (現役590行) と `BrowsingLogRepository` (未使用286行) の二重senderが併存し、新 seam は3つ目の競合抽象化を生む。
- 根拠: 変更頻度中だが Speculative。`diagnostics` で `status` に4 field追加が3ファイルに波及した実績はあるが、`_AssertUnionSubtypesCovered:75` と `GROUPED_SUBTYPES` で静的/動的二重ガード済み。新 subtype 追加時の漏れはコンパイル/起動時検出済み。

## なぜなぜ分析
- なぜ重複するか: `dashboardSqliteService` (sender, 現役), `dashboardSqliteProtocol` (型), `sqliteOperationSecurity` (token), `sqliteValidators` (検証), `handlers` (receiver) で同じ `subtype` を列挙。さらに `BrowsingLogRepository` (未使用) が二番煎じの deep module として併存
- なぜ 5点ではないか: 実際のタッチ数は 6点 (`ALL_DASHBOARD_SQLITE_SUBTYPES` + `TOKEN_EXEMPT_OPS` + union + `DashboardSqliteResponseFor` + handler Set + handler case + sender関数 + `DashboardSqliteValidator`)
- 解: 最小案: `queryLogs`/`searchLogs` の `for(attempt<2)` 45行×2 の重複を `withRetry<T>(fn, decode)` に抽出 (0.5pt)。フル統合は `SqliteRpc {query,search,mutate}` の3メソッドで `protocol+validation+token+retry+decode` を内部化するが、`BrowsingLogRepository` の去就決定が前提

## BDD受け入れシナリオ
Scenario: ハッピーパス — retry 重複が1箇所で完結する (最小案)
  Given `queryLogs` と `searchLogs` の retry が重複している
  When `withRetry` に抽出する
  Then `callDashboard` の retry が1箇所に

Scenario: エッジケース — 新 subtype が操作テーブル1行で完結する (フル案)
  Given 新 `subtype: 'export'` を追加する
  When `Op { subtype, schema, requiresToken, retry }` の宣言的テーブルに1行追加する
  Then `protocol/security/validator/handler/sender` の5箇所が同時駆動する

## 受け入れ基準
- [x] 最小案: `queryLogs`/`searchLogs` の重複 retry が `withRetry` に抽出されている
- [x] フル案では `SqliteRpc` が `query/search/mutate` の3メソッドで完結し、`dashboardSqliteProtocol` の union が `SqliteRpc` に集約されている（本PBIでは最小案を採用）
- [x] `BrowsingLogRepository` を本採用するか廃止するかが ADR またはコメントで決定されている

## テスト戦略
- 単体: 最小案: `withRetry` の `query`/`search` の retry テスト。フル案: `SqliteRpc` の 3メソッドの retry と token 要否テスト
- 統合: 実 `chrome.runtime.sendMessage` での `query` → `search` の連携検証。allowlist 完全性テスト `sqlite-security-integrity` が壊れていないことを検証
- E2E: 不要

## 見積もり
0.5pt（最小案, 要チームでの見積もり） — フル `SqliteRpc` は 3pt。`BrowsingLogRepository` の去就決定が前提で、急ぐ必要はない

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
