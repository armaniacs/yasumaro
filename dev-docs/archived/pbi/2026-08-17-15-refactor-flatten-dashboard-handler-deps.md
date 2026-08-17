# PBI: DashboardSqliteHandlerDeps の union を平坦化する

## ユーザーストーリー
開発者として、`DashboardSqliteHandlerDeps` が3つの独立したインターフェース群（ReadOnly, CoreCrud, MaintenanceBatch）の交差型として定義されている状態を解消したい。なぜなら、各ハンドラが15+メソッドの平坦なunionを受け取るため、どのハンドラがどのメソッドを使用しているかが型レベルで見えないから。

## ビジネス価値
- 各ハンドラの依存関係が型レベルで可視化される
- テスト時にハンドラごとに狭い deps を構築できる
- ハンドラ間の責務の境界が明確になる

## BDD受け入れシナリオ

```gherkin
Scenario: ハンドラごとの狭い依存
  Given readOnlyHandler が ReadOnlyDeps のみを受け取る
  When readOnlyHandler をテストする
  Then ReadOnlyDeps のみをモックできる
  And CoreCrudDeps / MaintenanceBatchDeps は不要

Scenario: ルーターでの型安全なディスパッチ
  Given ルーターがサブタイプに応じてハンドラにディスパッチする
  When サブタイプが read-only 系の場合
  Then readOnlyHandler にのみディスパッチされる
  And 型レベルで他のハンドラにアクセスできない

Scenario: 既存動作の維持
  Given 3つのサブハンドラがすべて存在する
  When DashboardSqliteHandlerDeps を平坦化する
  Then 既存の動作がすべて維持される
```

## 受け入れ基準
- [ ] readOnlyHandler が ReadOnlyDeps のみを受け取る
- [ ] coreCrudHandler が CoreCrudDeps のみを受け取る
- [ ] maintenanceBatchHandler が MaintenanceBatchDeps のみを受け取る
- [ ] DashboardSqliteHandlerDeps が3つのインターフェースの交差型として存在する
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- ルーターが正しくディスパッチすることを検証
- 各ハンドラが正しく動作することを検証

### 単体テスト
- 各ハンドラの既存テストが新しい deps でパスすることを確認
- 狭い deps でのハンドラ単体テストを追加

## 実装アプローチ
- **Outside-In**: 各ハンドラの deps を狭め、ルーターを修正
- **Red-Green-Refactor**: 修正後に型エラーが発生する場合のみ修正

## 見積もり
2ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）
- テスタビリティ: 狭い deps により改善
- リスク: 低（インターフェースの分割のみ）

## 実装者向け注記

### 現状コードの確認
```bash
# DashboardSqliteHandlerDeps の定義を確認
grep -n "DashboardSqliteHandlerDeps" src/background/handlers/dashboardSqlite/deps.ts
# 各ハンドラが使用するメソッドを確認
grep -n "deps\." src/background/handlers/dashboardSqlite/readOnlyHandler.ts | head -10
grep -n "deps\." src/background/handlers/dashboardSqlite/coreCrudHandler.ts | head -10
grep -n "deps\." src/background/handlers/dashboardSqlite/maintenanceBatchHandler.ts | head -10
```

### 実装手順
1. 各ハンドラが使用する deps メソッドを洗い出す
2. 各ハンドラの関数シグネチャを狭い deps に変更
3. ルーターがサブタイプに応じて適切な deps を渡すよう修正
4. createSqliteClientDeps で各ハンドラに狭い deps を提供
5. テストを更新

### 落とし穴
- DashboardSqliteHandlerDeps は `ReadOnlyDeps & CoreCrudDeps & MaintenanceBatchDeps` の交差型。ルーターはこの交差型を受け取り、サブハンドラには狭い型を渡すこと
- createSqliteClientDeps は15+メソッドを持つ。ルーターはこの15+メソッドを3つのサブハンドラに分割して渡すこと

## Definition of Done
- [ ] 各ハンドラが狭い deps を受け取る
- [ ] ルーターが型安全にディスパッチする
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
