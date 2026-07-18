# PBI: pendingSqliteQueueをチャンク単位のバッチINSERTに変更

## ユーザーストーリー
拡張機能ユーザーとして、Service Worker起動時に保留中の記録データが迅速に反映されてほしい、なぜなら現状は1件ずつ個別に `sqliteClient.insert()` を呼び出しており、N件分のOffscreenラウンドトリップ（各最大10秒タイムアウト）が順次発生し起動処理が遅延するから

## ビジネス価値
- Service Worker起動時のキュー処理を高速化
- 大量の保留レコードが溜まった場合の復旧時間を大幅短縮

## 実装者向け注記（フェーズ0の既実装確認結果）

Read で確認済み:
- `src/background/pendingSqliteQueue.ts:57-61`（`flushPendingRecords`）— `for (const record of queue)` で1件ずつ `sqliteClient.insert(record)` を呼び出すループ
- 既存の `sqliteClient.insertBatch(records: BrowsingLogRecord[])`（`src/background/sqliteClient.ts:221`）が既に実装済みで利用可能
- 対処案（親レポートより）: `insertBatch()` を使用してチャンク（50件単位）で一括挿入
- **副作用として要考慮（side-effects.md M10判定）**: バッチ化により「一部成功」ハンドリングができなくなり、1件のエラーで全滅する挙動に変化するリスクがある。個別insertの現状は各レコードの成否を独立して判定し `stillPending` に振り分けているため、バッチ化してもこの粒度を維持する設計にする必要がある

```bash
# 実装前の必須調査コマンド（insertBatchの戻り値仕様確認）
sed -n '215,260p' src/background/sqliteClient.ts
```

## BDD受け入れシナリオ

```gherkin
Scenario: 保留レコードがチャンク単位でバッチ挿入される
  Given 120件の保留中レコードがキューに存在する
  When flushPendingRecordsを実行する
  Then レコードは50件ずつのチャンク（3回のinsertBatch呼び出し）で処理される
  And 個別insertループと比較してOffscreenラウンドトリップ回数が大幅に削減される

Scenario: 一部チャンクが失敗しても他チャンクの成功分は反映される
  Given 3チャンク（150件）の保留レコードが存在し、2番目のチャンクでinsertBatchがエラーを返す
  When flushPendingRecordsを実行する
  Then 1番目・3番目のチャンクは正常にSQLiteへ反映される
  And 2番目のチャンク分のレコードのみがキューに残留する（全滅しない）
```

## 受け入れ基準
- [ ] `flushPendingRecords` を1件ずつの `insert()` ループから `insertBatch()` を使ったチャンク処理（50件単位）に変更
- [ ] チャンク単位でのエラーハンドリングを実装し、失敗したチャンクのレコードのみが `stillPending` に残る（全チャンク失敗時に全レコードが失われることを防ぐ）
- [ ] 既存のログ記録（`recovered`/`remaining`件数）が引き続き正確に動作する

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 不要

### 統合テスト
- 100件超の保留レコードで `flushPendingRecords` を実行し、`insertBatch` が複数回・チャンク単位で呼ばれることを検証
- 一部チャンクが失敗するケースで、成功分は反映され失敗分のみがキューに残ることを検証

### 単体テスト
- チャンク分割ロジック（配列を50件ずつに分割する関数、切り出す場合）を境界値（49件、50件、51件、100件）で検証

## 実装アプローチ
- **Outside-In**: 「一部チャンク失敗時に成功分は反映され失敗分のみ残る」統合テストをRedで書き、チャンク処理実装でGreenにする

## 見積もり
2pt（半日。チャンク分割ロジックとエラーハンドリングの粒度維持を含む）

## 技術的考慮事項
- 依存関係: 既存の `sqliteClient.insertBatch()` をそのまま利用
- テスタビリティ: `insertBatch` をモックしてチャンク単位の成功/失敗パターンを容易に再現可能
- 非機能要件: 起動時パフォーマンス改善

## 落とし穴
- `insertBatch()` の戻り値が「オールオアナッシング」（1件でも失敗すると全体が失敗扱い）なのか「部分成功をレポートする」仕様なのかを実装前に必ず確認すること。もし後者の粒度をサポートしない場合、チャンクサイズを小さくする（例: 10件単位）ことで全滅時の影響範囲を抑える設計判断が必要になる
- チャンクサイズ50件は親レポートの推奨値だが、`insertBatch`の実装（`INSERT_IGNORE_SQL`使用、`schema.ts:48`）を踏まえ、SQL文の長さ制約等に問題がないか確認すること

## Definition of Done
- [ ] `flushPendingRecords` がチャンク単位のバッチINSERTに変更されている
- [ ] 一部チャンク失敗時の部分成功ハンドリングが実装されている
- [ ] 単体・統合テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
