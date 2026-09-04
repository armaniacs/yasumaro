# PBI 07: メッセージ envelope の accept/reject を政策テーブルに集約

優先度: 7 位 / RICE 8.0 = (8 × 1 × 50%) / 0.5w / Strength: Worth exploring
backlog: [2026-09-05-00-backlog-arch3.md](2026-09-05-00-backlog-arch3.md)
依存: なし（他 6 件と独立）

## ユーザーストーリー
メッセージングを保守する開発者として、envelope 受理判定（shape＋version＋restore 順序＋migration-skip＋sender 厳格性）が 1 つの政策テーブルに集約されてほしい。なぜなら現状は `messageHandler.ts` の wrapper（:36-91）と `MessageRouter.dispatch`（:211-261）の 2 箇所に skip-list と sender チェックが分散し、順序リスク（restore→shape→migration）が wrapper に暗黙に存在するから。

## BDD受け入れシナリオ

```gherkin
Scenario: 新規メッセージ型は1エントリで追加できる
  Given 政策テーブルに1行追加した状態
  When  新規型のメッセージが届く
  Then  shape＋trust＋migration 振る舞いがテーブル駆動で判定される

Scenario: 順序がテーブルで明示される
  Given restore が必要な型
  When  envelope 判定を実行する
  Then  restore → shape → migration-skip の順序がテーブル順に実行される

Scenario: 拒否理由が返る
  Given 不正な sender または shape のメッセージ
  When  envelope 判定を実行する
  Then  accept/reject ＋ reason が返り、router は lookup のみになる
```

## 受け入れ基準
- [x] envelope 受理（shape＋version＋restore 順序＋migration-skip テーブル）が1モジュールに集約され、accept/reject＋reason を返す
- [x] `VALID_VISIT` / `CHECK_DOMAIN` の厳格 sender チェック（:238-246）がテーブル上の宣言になる
- [x] `TEST_*` / `CHECK_DOMAIN` の migration-skip（wrapper :79-83）と `CONTENT_CLEANSING_EXECUTED` の sender 特例（:84-87）がテーブルに移動する
- [x] pass-through ラッパーは作らない（政策テーブル形式のみ。deletion test の条件）
- [x] DESIGN_SPECIFICATIONS §2.1（Message Passing Validation）の振る舞いが不変
- [x] 既存 messaging/handler suite が green

## テスト戦略（t_wadaスタイル）
### 単体テスト
- fake restore/migration アダプタで envelope 政策を interface 経由で駆動（全型の accept/reject マトリクス）
- router テストは handler lookup に縮小
### 統合テスト
- 既存の messageHandler / MessageRouter テストは無修正で green
### 例外ハンドリング
- 拒否理由の文面（'Missing message type' / 'Invalid sender' 等）は不変

## 実装アプローチ
- **Outside-In**: 政策エントリ型（shape＋trust＋migration＋strict-sender）から設計 → wrapper のガードをテーブルに移動 → router は trust＋lookup に縮小

## 見積もり
0.5w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: restore / migration を fake adapter で差し替え可能に
- 非機能要件: セキュリティ振る舞い（sender 区別・type ホワイトリスト・tab 検証）は厳密に不変。Strength が Worth exploring のため、政策テーブル化で複雑さが増す場合は縮小して着地してよい

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "TEST_|CHECK_DOMAIN|CONTENT_CLEANSING_EXECUTED|restore\(\)|runDeferredStartupMigrations" src/background/messageHandler.ts
rg -n "VALID_VISIT|CHECK_DOMAIN" src/background/handlers/MessageRouter.ts
```
2026-09-05 時点: wrapper 107 行（VALID_MESSAGE_TYPES / NO_PAYLOAD_TYPES / protocolVersion ガード＋restore＋migration＋tabCache skip-list＋sender 特例）、dispatch 292 行中 :211-261 が trust＋厳格チェック＋validator。19 handlers＋trust table＋8 validators は既に dispatch の seam にある。

### 実装手順
1. envelope 政策エントリ型を定義（shape validator＋migration-skip＋strict-sender フラグ）
2. wrapper の skip-list と特例をテーブルに移動（1 型ずつ、テスト green を維持）
3. 厳格チェックをテーブル宣言化し、router を lookup に縮小
4. accept/reject マトリクステスト追加

### 落とし穴
- restore→shape→migration の順序は暗黙のセキュリティ前提。テーブル化で順序を変えないこと
- `content-script-allowed` と厳格チェックの2層は意図的（spoofing 防止）。潰さないこと
- Worth exploring のため、テーブル化が pass-through ラッパーに堕ちそうなら中止し backlog に戻すこと（deletion test 不合格の形態は作らない）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] messaging/handler 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（DESIGN_SPECIFICATIONS §2.1 に envelope seam を追記）
