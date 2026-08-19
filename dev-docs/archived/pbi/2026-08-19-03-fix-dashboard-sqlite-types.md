# PBI: DashboardSqliteMessage ペイロード型の型安全性向上

## 問題説明
`src/background/messageTypes.ts` の `DashboardSqliteMessage` は `payload?: Record<string, unknown>` として定義されている。これにより、SQLiteクエリの内容が静的型で保証されず、誤ったペイロンド構造がランタイムまで到達する可能性がある。

## 優先度
- 順位: 03 / 05
- RICEスコア: 60（Reach=30 / Impact=1 / Confidence=100% / Effort=0.5）
- 根拠: ダッシュボードのSQLite機能利用者に影響。ランタイムエラーを防ぐための型安全性向上。

## BDD受け入れシナリオ

Scenario: DashboardSqliteMessage が厳密な型で定義されている
  Given 開発者が DashboardSqliteMessage を import する
  When IDEの型チェックを実行する
  Then payload の構造が型として検証可能である

Scenario: 不正なペイロードがコンパイル時に検出される
  Given DashboardSqliteMessage の型定義が厳密化されている
  When 開発者が誤ったペイロド構造を持つメッセージを作成する
  Then TypeScript コンパイラがエラーを報告する

## 受け入れ基準
- [ ] `DashboardSqliteMessage` の payload が具体的な共用体型に置き換えられる
- [ ] 既存のテストがパスする
- [ ] 型定義がダッシュボードハンドラと一致する

## テスト戦略
- 単元: `messageTypes.ts` の型テスト追加
- 統合: ダッシュボードSQLiteハンドラの型チェックテスト

## 見積もり
0.5ストーリーポイント

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
