# PBI: Dashboard SQLite Proxy Collapse — 637行のボイラープレートを汎用パスに集約

## ユーザーストーリー
開発者として、`dashboardSqliteService.ts`（637行）の~20関数が全て同一パターン（ペイロード構築→メッセージ送信→レスポンス検証→返却）を繰り返す状態を解消したい。なぜなら、新しいSQLite操作を追加するたびに15-30行のボイラープレートを書く必要があり、テストも20回分必要になるからだ。

## 優先度
- 順位: 02 / 5
- RICEスコア: (Reach=6 × Impact=2 × Confidence=0.8) / Effort=2 = 4.8
- 根拠: 同点の#1(SavedUrlRepository)よりリスク軽減が小さいため2位。しかし2pwのクイックウィンであり、着手しやすい

## BDD受け入れシナリオ
Scenario: 汎用 callDashboard で操作が1つに集約される
  Given Dashboard がSQLite操作を要求する
  When `callDashboard<TReq, TRes>()` が呼出される
  Then タイムアウト・トークン付与・エラー分類が1経路で処理される

Scenario: トークン不要な読み取り操作が正常に動作する
  Given `tokenExempt` に含まれる操作（query, search, get_count 等）を要求する
  When `callDashboard()` が呼出される
  Then トークンなしで送信され、レスポンスが正しくデコードされる

Scenario: デコードエラーがユーザーに伝達される
  Given レスポンスのフィールドが予想と異なる
  When バリデータがデコードに失敗する
  Then `{ error: "..." }` 形式でエラーメッセージが返される

## 受け入れ基準
- [ ] ~20の個別関数が `callDashboard<TReq, TRes>()` に集約される
- [ ] `queryLogs` と `searchLogs` のリトライロジックは汎用パスから除外し、個別に保持する
- [ ] プロトコルバージョニング（`CURRENT_PROTOCOL_VERSION`）は変更しない
- [ ] トークンセキュリティモデル（`tokenExempt`）は変更しない
- [ ] `ServiceResult<T>` 型は維持する

## テスト戦略
- E2E: Dashboard UIから一連のSQLite操作（クエリ・トグルスター・削除・エクスポート）が正常に動作する
- 統合: `callDashboard()` × `sendDashboardMessage()` × `chrome.runtime.sendMessage`
- 単体: `callDashboard()` のタイムアウト・エラー分類・デコードロジック

## 見積もり
2人日

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
