# PBI: Gist 同期ターゲットの未同期レコード取り残し防止

元指摘: Checking Team (High: Domain Logic Expert)

## 実装状況（完了日: 2026-07-21、状態: ✅ 完了）

## ユーザーストーリー

開発チームとして、`GistSyncTarget.syncBatch()` が最新5件の中から未同期レコードをフィルタする現在の実装を修正したい。なぜなら、未同期レコードが6件以上あり最新5件がすべて同期済みの場合、それ以降の未同期レコードが永遠に同期されず、Gist バックアップが不完全になるから。

## ビジネス価値

- Gist バックアップの完全性向上
- ユーザーが多くのページを記録しても、記録漏れが発生しない

## 前提・制約

- `gist_synced` カラムは既に `browsing_logs` テーブルに存在
- `SqliteClient.query()` は `limit`, `orderBy`, `orderDir` をサポート
- クエリビルダーが WHERE 句フィルタをサポートするか、生 SQL を使用するかは実装時に確認

## BDD受け入れシナリオ

```gherkin
Feature: Gist sync completeness

  Scenario: Batch query filters only unsynced records
    Given 10 records exist and 7 are unsynced
    When `syncBatch()` runs
    Then it queries records with `gist_synced = 0`
    And all 7 unsynced records are eventually synced

  Scenario: Large unsynced backlog is processed with pagination
    Given 250 unsynced records exist
    When `syncBatch()` runs
    Then it processes records in batches using LIMIT/OFFSET
    And no records are skipped
```

## 受け入れ基準

- [ ] `GistSyncTarget.syncBatch()` の `sqliteClient.query()` に `gist_synced = 0` フィルタを追加
- [ ] 最新5件の中から未同期をフィルタする現在のロジックを廃止
- [ ] 一度に大量同期を避けるため、LIMIT + OFFSET によるページネーションを実装（1回あたり上限 50件程度を検討）
- [ ] `npm run type-check` / `npm test` が成功

## テスト戦略

### 単体テスト
- `gistSyncTarget.test.ts` に「最新5件が同期済みでも後続の未同期レコードが同期される」テストを追加
- ページネーション動作のテスト

### 統合テスト
- 大量未同期レコード（例: 101件）を作成し、複数回 `syncBatch()` 呼び出しで全件同期されることを確認

## 実装アプローチ

- **Inside-Out**: `SqliteClient.query` のオプションに WHERE 相当のフィルタを追加するか、専用メソッド `queryUnsyncedForGist(limit, offset)` を追加
- `syncBatch()` はループ内でページネーションし、取得件数が0になるまで同期を繰り返す

## 見積もり
1pt（クエリ変更 + ページネーションループ + テスト）

## 副作用
🟢 なし — 既存の正常系動作を維持しつつ、未同期取り残しを解消するのみ。

## 落とし穴
- `gist_synced` カラムにインデックスがない場合、大量データ時の WHERE 検索が遅くなる。必要に応じてインデックス追加を検討。
- `syncBatch()` の呼び出し元がタイムアウトを想定している場合、ページネーションループは短時間で完了するよう制御する。

## Definition of Done
- [ ] すべての受け入れ基準を満たす
- [ ] テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
