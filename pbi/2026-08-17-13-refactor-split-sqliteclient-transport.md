# PBI: SqliteClient を transport と domain に分割する

## ユーザーストーリー
開発者として、`SqliteClient` の477行が Chrome offscreen document のライフサイクル管理（transport）とドメイン操作（insert, query, search, purge）を混在させている状態を解消したい。なぜなら、transport 層が domain 層と緊密に結合しているため、offscreen document なしにドメインロジックをテストできないから。

## ビジネス価値
- transport 層が分離され、ドメインロジックが offscreen document なしにテストできる
- 2つのアダプタが正当化される: OffscreenTransport（本番）、InMemoryTransport（テスト）
- 新しいストレージバックエンドの追加が容易になる

## BDD受け入れシナリオ

```gherkin
Scenario: 本番環境での SQLite 操作
  Given OffscreenTransport が Injected されている
  When insertResult が呼ばれる
  Then OffscreenTransport が offscreen document にメッセージを送信する
  And 結果が返される

Scenario: テスト環境での SQLite 操作
  Given InMemoryTransport が Injected されている
  When insertResult が呼ばれる
  Then InMemoryTransport がインメモリデータに書き込む
  And offscreen document は作成されない

Scenario: Transport の切り替え
  Given OffscreenTransport が利用不可の場合
  When SqliteClient が初期化される
  Then エラーメッセージが返される
  And ドメインロジックは実行されない
```

## 受け入れ基準
- [ ] `OffscreenTransport` クラスが新設されている
- [ ] SqliteClient が transport をコンストラクタで受け取る
- [ ] SqliteClient に `ensureOffscreenDocument` がない
- [ ] SqliteClient に `sendOnce` / `msgOffscreen` がない
- [ ] テストが InMemoryTransport を使用している
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- SqliteClient と OffscreenTransport の統合テストを追加
- タイムアウト・リトライ動作の検証

### 単体テスト
- SqliteClient のドメインロジックを InMemoryTransport でテスト
- OffscreenTransport の単体テストを追加

## 実装アプローチ
- **Outside-In**: OffscreenTransport を定義し、SqliteClient から transport を分離
- **Red-Green-Refactor**: 分離後に型エラーが発生する場合のみ修正

## 見積もり
3ポイント

## 技術的考慮事項
- 依存関係: なし（独立して実装可能）
- テスタビリティ: InMemoryTransport により大幅に改善
- リスク: 中（SqliteClient の内部構造を変更する）

## 実装者向け注記

### 現状コードの確認
```bash
# ensureOffscreenDocument の使用箇所を確認
grep -n "ensureOffscreenDocument" src/background/sqliteClient.ts
# sendOnce の使用箇所を確認
grep -n "sendOnce\|msgOffscreen" src/background/sqliteClient.ts
# requestQueue の使用箇所を確認
grep -n "requestQueue" src/background/sqliteClient.ts
```

### 実装手順
1. OffscreenTransport インターフェースと OffscreenTransport クラスを定義
2. SqliteClient に transport をコンストラクタで受け取るよう修正
3. ensureOffscreenDocument / sendOnce / msgOffscreen を OffscreenTransport に移動
4. InMemoryTransport をテスト用に実装
5. テストを InMemoryTransport 使用に更新
6. getSharedSqliteClient で OffscreenTransport を注入

### 落とし穴
- OffscreenTransport は requestQueue（Mutex）を持つ。SqliteClient との境界を明確にすること
- getSharedSqliteClient は共有インスタンスを返す。transport も共有すること

## Definition of Done
- [ ] OffscreenTransport が独立したモジュールとして存在する
- [ ] SqliteClient に ensureOffscreenDocument がない
- [ ] テストが InMemoryTransport を使用している
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
