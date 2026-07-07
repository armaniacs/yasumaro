# PBI: SQLite に診断メタデータ（content, tokens, bytes, durations 等）を永続化

## ユーザーストーリー
開発者として、レガシーストレージ（`savedUrlsWithTimestamps`）のみに保存されている診断メタデータも SQLite に保存したい。なぜなら `purgeLegacyStorage()` によって chrome.storage.local から large field が削除された場合でも、SQLite 側に全データが残るようにしたいから。

## ビジネス価値
- `purgeLegacyStorage()` によるクォータ回復後も content, tokens, bytes, durations 等の診断データが消失しない
- ダッシュボード SQLite 履歴パネルで content（本文）や AI プロバイダ情報を表示可能になる
- レガシーストレージに依存しないデータ保存基盤が完成する

## 既実装確認（Phase 0）
- `src/offscreen/schema.ts` の `browsing_logs` テーブル: content, tokens, bytes, aiProvider, aiModel, durations 等のカラムは存在しない
- `src/utils/sqlite-types.ts` の `BrowsingLogRecord`: 上記フィールドは存在しない
- `src/background/pipeline/RecordingPipeline.ts` の `createSaveSqliteStep`: BrowsingLogRecord に上記フィールドを渡していない
- `KaiSummary` は `summary` カラムとして既に保存済み ✓
- 全体的に未実装と判断

## BDD受け入れシナリオ

```gherkin
Feature: SQLite 診断メタデータ保存
  SQLite browsing_logs テーブルに content, tokens, bytes, AI プロバイダ・モデル,
  処理時間, L0抽出情報, フォールバックフラグを永続化する。

  Scenario: content を含むフルメタデータが SQLite に保存される
    Given ページ "https://example.com/article" を記録する
    And パイプラインが content="長い本文...", aiSummary="要約", 
      sentTokens=100, receivedTokens=50, aiProvider="openai", aiModel="gpt-4",
      aiDuration=5000, fallbackTriggered=true を含むメタデータを生成する
    When パイプラインの saveSqliteStep が実行される
    Then browsing_logs テーブルに content, sent_tokens, received_tokens,
      ai_provider, ai_model, ai_duration_ms, fallback_triggered が正しく保存される
    And FTS5 検索で content 内のテキストがヒットする

  Scenario: content が未設定（null）の場合も保存に成功する
    Given ページの content 抽出に失敗した場合
    When パイプラインの saveSqliteStep が実行される
    Then browsing_logs の content カラムは NULL として保存される
    And 他のメタデータ（tokens, durations 等）は通常通り保存される

  Scenario: 既存レコードにメタデータが追記される
    Given browsing_logs に content カラムがない古いレコードが存在する
    When パイプラインが当該 URL を再処理する
    Then content を含む全メタデータが更新される（UPSERT）
```

## 受け入れ基準
- [ ] SQLite `browsing_logs` テーブルに content, tokens, bytes, durations, AI プロバイダ/モデル, L0抽出情報, fallback_triggered のカラムが追加されている
- [ ] `BrowsingLogRecord` 型に全フィールドが追加されている
- [ ] パイプラインの saveSqliteStep が全フィールドを SQLite に書き込む
- [ ] `offscreen/schema.ts` と `opfsWorker.ts` の両方でスキーマが一貫している
- [ ] 既存レコードのマイグレーション（ALTER TABLE）が行える
- [ ] FTS5 のトリガーが content カラムを検索対象に含む（または含まない判断が明示されている）
- [ ] content の保存はオプショナル（null 許容）で、常に保存されるとは限らない

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- パイプライン統合テスト: フルメタデータの SQLite 保存確認

### 統合テスト
- `saveSqliteStep` テスト: モック SQLite クライアントに全フィールドが渡されることを確認
- `RecordingPipeline` テスト: `createSaveSqliteStep` が context から全フィールドを抽出して BrowsingLogRecord を構築することを確認

### 単体テスト
- `schema.ts`: ALTER TABLE マイグレーション SQL の構文テスト
- `sqlite-types.ts`: 新規フィールドの型定義テスト
- `offscreen/sqlite.ts` の insert/update: 新規カラムの読み書きテスト

## 実装アプローチ
- **Outside-In**: まず saveSqliteStep のテストを書き（失敗）、次に BrowsingLogRecord 型を拡張し、最後に SQLite schema を変更する
- **マイグレーション戦略**: `ALTER TABLE ADD COLUMN` を使用。既存レコードのカラムは NULL で初期化される
- **content の扱い**: FTS5 検索対象には含めない（content は巨大でトークン数が爆発するため）。content の全文検索が必要な場合は別途判断

## 見積もり
13 ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- **依存関係**: なし（独立した PBI）
- **スキーママイグレーション**: `sqlite.ts` の `initDatabase()` 内で `ALTER TABLE` を実行する。OPFS Worker 側（`opfsWorker.ts`）でも同様のマイグレーションが必要
- **content のサイズ**: content は最大 64KB。SQLite では問題ないが、クエリ性能と DB サイズに注意
- **テスタビリティ**: オフスクリーン文書経由の SQLite 操作はモック化が困難。`sqliteClient.ts`（Service Worker 側）のメッセージパッシングをテストする

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "BrowsingLogRecord" src/
grep -rn "insert(" src/offscreen/sqlite.ts | head -5
grep -rn "schema" src/offscreen/
```

### 追加するカラム一覧

| カラム名 | 型 | NULL | デフォルト | 対応する savedUrlsWithTimestamps フィールド |
|----------|-----|------|-----------|------------------------------------------|
| `content` | TEXT | YES | NULL | `content` |
| `masked_count` | INTEGER | YES | NULL | `maskedCount` |
| `cleansed_reason` | TEXT | YES | NULL | `cleansedReason` |
| `ai_provider` | TEXT | YES | NULL | `aiProvider` |
| `ai_model` | TEXT | YES | NULL | `aiModel` |
| `ai_duration_ms` | INTEGER | YES | NULL | `aiDuration` |
| `obsidian_duration_ms` | INTEGER | YES | NULL | `obsidianDuration` |
| `sent_tokens` | INTEGER | YES | NULL | `sentTokens` |
| `received_tokens` | INTEGER | YES | NULL | `receivedTokens` |
| `original_tokens` | INTEGER | YES | NULL | `originalTokens` |
| `cleansed_tokens` | INTEGER | YES | NULL | `cleansedTokens` |
| `page_bytes` | INTEGER | YES | NULL | `pageBytes` |
| `candidate_bytes` | INTEGER | YES | NULL | `candidateBytes` |
| `original_bytes` | INTEGER | YES | NULL | `originalBytes` |
| `cleansed_bytes` | INTEGER | YES | NULL | `cleansedBytes` |
| `ai_summary_original_bytes` | INTEGER | YES | NULL | `aiSummaryOriginalBytes` |
| `ai_summary_cleansed_bytes` | INTEGER | YES | NULL | `aiSummaryCleansedBytes` |
| `ai_summary_cleansed_elements` | INTEGER | YES | NULL | `aiSummaryCleansedElements` |
| `ai_summary_cleansed_reason` | TEXT | YES | NULL | `aiSummaryCleansedReason` |
| `ai_summary_cleansed_reasons` | TEXT | YES | NULL | `aiSummaryCleansedReasons` |
| `extracted_sentences_bytes` | INTEGER | YES | NULL | `extractedSentencesBytes` |
| `extracted_sentences_original_bytes` | INTEGER | YES | NULL | `extractedSentencesOriginalBytes` |
| `fallback_triggered` | INTEGER | YES | 0 | `fallbackTriggered` |

### マイグレーションSQL（例）
```sql
ALTER TABLE browsing_logs ADD COLUMN content TEXT;
ALTER TABLE browsing_logs ADD COLUMN masked_count INTEGER;
ALTER TABLE browsing_logs ADD COLUMN ai_provider TEXT;
ALTER TABLE browsing_logs ADD COLUMN ai_model TEXT;
ALTER TABLE browsing_logs ADD COLUMN ai_duration_ms INTEGER;
...
```

### 実装手順
1. `src/utils/sqlite-types.ts` の `BrowsingLogRecord` に全フィールドを追加（オプショナル/nullable）
2. `src/offscreen/schema.ts` の `SCHEMA_SQL` に CREATE TABLE のカラム追加 + マイグレーション用 ALTER TABLE 文を追加
3. `src/offscreen/sqlite.ts` の initDatabase で ALTER TABLE を実行（既存 DB 移行）
4. `src/offscreen/opfsWorker.ts` でも同様のマイグレーションを実施
5. `src/offscreen/sqlite.ts` の insert/update 関数で新規カラムを扱うよう修正
6. `src/background/pipeline/RecordingPipeline.ts` の `createSaveSqliteStep` で content 等を BrowsingLogRecord に含める
7. `src/background/pipeline/steps/saveSqliteStep.ts` で全フィールドが渡されることを確認
8. テストを追加して全パス確認

### 落とし穴
- `ALLOWED_ORDER_COLUMNS`（sqlite.ts 22行目）に新しいカラムが必要なら追加する（ORDER BY での SQL インジェクション防止）
- content は巨大なため、SELECT 時のデフォルトで除外するか、明示的にリクエストされた場合のみ返す設計を検討
- FTS5 トリガーに content を含めると DB 肥大化と更新性能低下を招く。content の FTS5 検索は本 PBI のスコープ外

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] `dev-docs/ADR/2026-07-07-sqlite-chrome-storage-dual-write.md` を更新（保存先の増加を反映）
