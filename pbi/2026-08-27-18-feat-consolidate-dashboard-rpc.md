# PBI: Dashboard Sqlite RPC の SqliteRpc 統合

## ユーザーストーリー
開発者として、dashboard の `subtype` が5箇所で重複定義されている `SqliteRpc` を1つの `SqliteRpc` seam に統合したい、なぜなら新 `subtype` 追加で5ファイル編集が必要で、`callDashboard` の retry ループが `queryLogs`/`searchLogs` で重複しているから。

## 優先度
- 順位: 7 / 7
- RICEスコア: 120（Reach=30 / Impact=1 / Confidence=60% / Effort=0.30）
- 根拠: 変更頻度中だが Speculative。`diagnostics` で `status` に4 field追加が3ファイルに波及した実績がある。

## なぜなぜ分析
- なぜ重複するか: `dashboardSqliteService` (sender), `dashboardSqliteProtocol` (型), `sqliteOperationSecurity` (token), `sqliteValidators` (検証), `handlers` (receiver) で同じ `subtype` を列挙
- なぜ気づかないか: `_AssertUnionSubtypesCovered` で静的保証はあるが依然5ファイル編集
- 解: `SqliteRpc { query, search, mutate }` が `protocol + validation + token + retry + decode` を内部化

## BDD受け入れシナリオ
Scenario: ハッピーパス — 新 subtype が1ファイルで完結する
  Given 新 `subtype: 'export'` を追加する
  When `SqliteRpc` に1行追加する
  Then 5箇所の重複編集が不要になる

Scenario: エッジケース — retry が一箇所で完結する
  Given `queryLogs` と `searchLogs` の retry が重複している
  When `SqliteRpc` に統合する
  Then `callDashboard` の retry が1箇所に

## 受け入れ基準
- [ ] `SqliteRpc` が `query/search/mutate` の3メソッドで完結している
- [ ] `dashboardSqliteProtocol` の union が `SqliteRpc` に集約されている
- [ ] `queryLogs`/`searchLogs` の重複 retry が削除されている

## テスト戦略
- 単体: `SqliteRpc` の `query`/`search`/`mutate` の retry テスト
- 統合: 実 `chrome.runtime.sendMessage` での `query` → `search` の連携検証
- E2E: 不要

## 見積もり
2pt（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
