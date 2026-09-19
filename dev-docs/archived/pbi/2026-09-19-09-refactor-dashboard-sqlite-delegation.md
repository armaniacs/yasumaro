# PBI: dashboardSqlite ハンドラを薄い委譲層に分離する

## ユーザーストーリー
開発者として、新規 message type 追加時に触る場所が一か所であってほしい、なぜなら委譲層と実処理層の二重管理は境界侵食を進めるから

## 優先度
- 順位: 09 / 13
- RICEスコア: 12.8（Reach=10 / Impact=2 / Confidence=80% / Effort=1.25）
- 根拠: god node 周辺の構造改善。新規追加時の迷いをなくす

## ビジネス価値
新規 message type 追加のリードタイム短縮。境界違反の混入防止

## BDD受け入れシナリオ

```gherkin
Scenario: 新規 type 追加は実処理層だけで完結する
  Given 新しい dashboardSqlite の message type
  When 実処理層に追加する
  Then 委譲層の定型追加だけで動作する
  And 既存 type の挙動が変わらない

Scenario: 依存注入が必須化される
  Given 新規分岐の追加
  When deps.ts を経由しない
  Then レビューまたは lint で検出される
```

## 受け入れ基準
- [x] dashboardSqliteHandlers.ts が薄い委譲層になっている（既存：12行の re-export のみ）
- [x] 実処理が dashboardSqlite/ 配下に完全移譲されている（既存：4ハンドラ＋partition fail-fast）
- [x] 新規分岐の deps.ts 経由が必須化（index.ts の partition コメントに明記）されている
- [x] 既存テストが green である（変更なし）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- dashboard の主要操作フローが従来通りである

### 統合テスト
- 各 message type の委譲経路テスト

### 単体テスト
- 委譲層の振り分けロジック

## 実装アプローチ
- **Outside-In**: 委譲経路の統合テストから開始
- **Red-Green-Refactor**: 振る舞いを変えずに移譲する

## 見積もり
3ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 委譲前後で入出力が同じことをテストで保証
- 非機能要件: god node への依存を増やさない

## 実装者向け注記

### 現状コードの確認
```bash
ls src/background/handlers/dashboardSqlite/; grep -rn "dashboardSqlite" src/background/handlers/dashboardSqliteHandlers.ts | head -20
```

### 実装手順
1. 現行の振り分けテストを書く
2. 実処理を順に移譲する
3. deps.ts 経由の必須化を文書化する

### 落とし穴
- 一度に全部移さず type 単位で段階移行すること
- MessageRouter 側の分岐も同時にいじらないこと（スコープ外）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
