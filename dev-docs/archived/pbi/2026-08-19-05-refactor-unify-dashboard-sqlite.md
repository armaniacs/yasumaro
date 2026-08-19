# PBI: Unify the Dashboard-SQLite cross-seam

## ユーザーストーリー
開発者として、Dashboard から SQLite へのリクエストが単一の型付き RPC インターフェースを通過する状態がほしい。なぜならバリデーションロジックが重複せず、 Dashboard と Service Worker の両方で同じ契約が共有されるから。

## 優先度
- 順位: 05 / 05
- RICEスコア: 1.87（Reach=4 / Impact=2 / Confidence=70% / Effort=3 人週）
- 根拠: Strong 推薦だが最高 Effort。`queryLogs` が 6 ファイル・3 レイヤーを通過する最も摩擦の大きい箇所。バリデーション重複の除去効果は大きいが、インターフェース設計に慎重さが必要。

## BDD受け入れシナリオ
Scenario: Dashboard から SQLite へのリクエストが単一の RPC クライアントを通過する
  Given `SqliteRpcClient` インターフェースが `DashboardSqliteRequest` / `DashboardSqliteResponseFor` の型付き discriminated union に駆動されている
  When Dashboard 側の `queryLogs` がリクエストを送信する
  Then リクエストは `chrome.runtime.sendMessage` を介さずに `SqliteRpcClient` のメソッドとして呼び出され、レスポンスは単一のバリデーション層で検証される

Scenario: バリデーションロジックが重複しない
  Given `requiredRows`、`requiredNonNegativeNumber` などのバリデーターが、Dashboard と SW の両方から import 可能な純粋関数モジュールとして抽出されている
  When `dashboardSqliteService.ts` と `sqliteClient.ts` の両方でレスポンスを検証する
  Then 同じバリデーター関数が使用され、片方だけが更新されて不一致になることがない

## 受け入れ基準
- [x] `SqliteRpcClient` インターフェースが定義され、Dashboard 側と SW 側の両方が実装している
- [x] 共有バリデーターモジュールが chrome API に依存せず、Dashboard と SW の両方から import 可能な純粋関数として実装されている
- [x] `dashboardSqliteService.ts` の `requiredRows`、`requiredNonNegativeNumber` 等が共有バリデーターに置き換わっている
- [x] `sqliteClient.ts` の `call()` メソッドのバリデーションが共有バリデーターを使用している
- [x] `categorizeError` などのエラー分類も必要に応じて共有化し、Dashboard 側でも `retriable` 等の情報を利用可能にする
- [x] `confirmToken` 取得や破壊的操作の確認は Dashboard 側アダプタに残し、SW 側実装には漏れ出さない
- [x] 既存の `dashboardSqliteService.test.ts` と `sqliteClient.test.ts` が変更なしでパスする

## テスト戦略
- 単体: `SqliteRpcClient` の Dashboard 側実装と SW 側実装をそれぞれテスト
- 統合: Dashboard → SW → offscreen の E2E リクエストが正常に完了
- E2E: ダッシュボードで履歴検索→表示→スター切り替え→削除の一連の流れが正常に動作

## リスクと留意事項
- Dashboard と SW は別の実行コンテキスト（options page / service worker）なので、共有バリデーターが chrome API に依存しないことを厳密に確認する
- `ServiceResult<T>`（Dashboard 側）と `CallResult<T>`（SW 側）は異なる結果ラッパーを持つ。統一しない場合は、各アダプタが共有バリデーターの結果を自分のラッパーに包む
- `confirmToken` や破壊的操作の確認は Dashboard 側の責務であり、SW 側実装に漏らさない
- この PBI は `sqliteClient.ts` のインターフェースを変更するため、既存の `recordingPipeline` などの呼び出し元にも影響が出る可能性がある

## 見積もり
3 ストーリーポイント（要チームでの見積もり）

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` の SQLite セクションを更新）
- [x] `dashboardSqliteService.ts` と `sqliteClient.ts` の重複バリデーションが解消されている
