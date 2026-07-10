# PBI-1: SQLite への診断メタデータ永続化 — 設計書

## 概要

現在、content（本文）以外の診断メタデータ（tokens, bytes, AI provider/model, durations 等）はレガシーストレージ `savedUrlsWithTimestamps` にのみ保存されている。`purgeLegacyStorage()` によってこれらのデータが消失するリスクを回避するため、SQLite `browsing_logs` テーブルに新規カラムを追加して永続化する。

## 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/utils/sqlite-types.ts` | `BrowsingLogRecord` に新規フィールド追加 |
| `src/offscreen/schema.ts` | `SCHEMA_SQL` にカラム追加 + `ALTER TABLE` マイグレーション文 |
| `src/offscreen/sqlite.ts` | `initDatabase()` で ALTER TABLE 実行。`insert()` / `update()` / `ALLOWED_ORDER_COLUMNS` 更新 |
| `src/offscreen/opfsWorker.ts` | OPFS Worker パスでも同様のマイグレーション + insert/update 更新 |
| `src/offscreen/offscreen.ts` | メッセージハンドラの型対応（必要なら） |
| `src/background/pipeline/RecordingPipeline.ts` | `createSaveSqliteStep()` で context から全フィールド抽出 |
| `src/background/sqliteClient.ts` | 新規カラムを含むレスポンス型の対応（必要なら） |

## スキーマ設計

### 追加するカラム

```sql
-- browsing_logs テーブルに追加するカラム（全て NULL 許容）
content TEXT,
masked_count INTEGER,
cleansed_reason TEXT,
ai_provider TEXT,
ai_model TEXT,
ai_duration_ms INTEGER,
obsidian_duration_ms INTEGER,
sent_tokens INTEGER,
received_tokens INTEGER,
original_tokens INTEGER,
cleansed_tokens INTEGER,
page_bytes INTEGER,
candidate_bytes INTEGER,
original_bytes INTEGER,
cleansed_bytes INTEGER,
ai_summary_original_bytes INTEGER,
ai_summary_cleansed_bytes INTEGER,
extracted_sentences_bytes INTEGER,
extracted_sentences_original_bytes INTEGER,
fallback_triggered INTEGER DEFAULT 0,
```

総カラム数: 21 → 42（21 追加）

### content カラムについて

- content はカラムとして追加するが、**Pipeline の createSaveSqliteStep では値は常に null として保存する**
- content に値が入るのは PBI-3 以降
- カラムを先に追加しておくことで、PBI-3 で ALTER TABLE を再度実行する必要がなくなる

### 除外したフィールド（YAGNI）

- `ai_summary_cleansed_elements` — 診断用、価値が薄い
- `ai_summary_cleansed_reason` / `ai_summary_cleansed_reasons` — 同上
- L0 抽出関連のニッチな値は extracted_* のみ保存

## マイグレーション戦略

### 初回 CREATE TABLE

`SCHEMA_SQL` に新しいカラムを含めた完全な CREATE TABLE 文を記述する。新規インストールではこの CREATE TABLE が実行される。

### 既存 DB のマイグレーション

`initDatabase()` 内で `CREATE TABLE IF NOT EXISTS` の後に、各カラムの `ALTER TABLE ADD COLUMN` を実行する。

```typescript
// ALTER TABLE はカラムが既に存在する場合はエラーになるため、
// エラーハンドリングで握りつぶす
const migrationColumns = [
  'content TEXT',
  'masked_count INTEGER',
  'cleansed_reason TEXT',
  'ai_provider TEXT',
  'ai_model TEXT',
  'ai_duration_ms INTEGER',
  'obsidian_duration_ms INTEGER',
  'sent_tokens INTEGER',
  'received_tokens INTEGER',
  'original_tokens INTEGER',
  'cleansed_tokens INTEGER',
  'page_bytes INTEGER',
  'candidate_bytes INTEGER',
  'original_bytes INTEGER',
  'cleansed_bytes INTEGER',
  'ai_summary_original_bytes INTEGER',
  'ai_summary_cleansed_bytes INTEGER',
  'extracted_sentences_bytes INTEGER',
  'extracted_sentences_original_bytes INTEGER',
  'fallback_triggered INTEGER DEFAULT 0',
];

for (const colDef of migrationColumns) {
  try {
    await db.exec(`ALTER TABLE browsing_logs ADD COLUMN ${colDef}`);
  } catch {
    // カラムが既に存在する場合は無視
  }
}
```

OPFS Worker パス（`opfsWorker.ts`）でも同様のマイグレーションを `handleOpensDatabase` 内で実行する。

## 型定義

`BrowsingLogRecord` （`src/utils/sqlite-types.ts`）に全ての新規フィールドを追加する。各フィールドは `undefined` を許容する（パイプラインで値が未設定の場合があるため）。

```typescript
export interface BrowsingLogRecord {
  // ... existing fields
  
  // 新規フィールド（全て optional）
  content?: string | null;
  masked_count?: number | null;
  cleansed_reason?: string | null;
  ai_provider?: string | null;
  ai_model?: string | null;
  ai_duration_ms?: number | null;
  obsidian_duration_ms?: number | null;
  sent_tokens?: number | null;
  received_tokens?: number | null;
  original_tokens?: number | null;
  cleansed_tokens?: number | null;
  page_bytes?: number | null;
  candidate_bytes?: number | null;
  original_bytes?: number | null;
  cleansed_bytes?: number | null;
  ai_summary_original_bytes?: number | null;
  ai_summary_cleansed_bytes?: number | null;
  extracted_sentences_bytes?: number | null;
  extracted_sentences_original_bytes?: number | null;
  fallback_triggered?: number | null;
}
```

`BrowsingLogEntry`（dashboard 用の派生型）は `Omit<BrowsingLogRecord, 'is_deleted'> & { id: number }` のままで自動的に新規フィールドを継承する。

## パイプライン修正

`RecordingPipeline.ts` の `createSaveSqliteStep()` で、context からフィールドを抽出する:

```typescript
const { data, privacyResult, aiDuration, obsidianDuration, extractedSentencesBytes, extractedSentencesOriginalBytes } = context;

const record: BrowsingLogRecord = {
  url,
  title: title || null,
  summary: privacyResult?.summary || null,
  tags: ...,
  created_at: Date.now(),
  domain: extractDomain(url) || null,
  visit_duration: null,
  scroll_ratio: null,
  is_starred: 0,
  is_deleted: 0,
  // 新規フィールド
  content: null, // PBI-3 まで常に null
  cleansed_reason: data.cleansedReason || null,
  masked_count: (data.maskedCount ?? privacyResult?.maskedCount) || null,
  ai_provider: privacyResult?.aiProvider || null,
  ai_model: privacyResult?.aiModel || null,
  ai_duration_ms: aiDuration ?? null,
  obsidian_duration_ms: obsidianDuration ?? null,
  sent_tokens: privacyResult?.sentTokens ?? null,
  received_tokens: privacyResult?.receivedTokens ?? null,
  original_tokens: privacyResult?.originalTokens ?? null,
  cleansed_tokens: privacyResult?.cleansedTokens ?? null,
  page_bytes: data.pageBytes ?? null,
  candidate_bytes: data.candidateBytes ?? null,
  original_bytes: data.originalBytes ?? null,
  cleansed_bytes: data.cleansedBytes ?? null,
  ai_summary_original_bytes: data.aiSummaryOriginalBytes ?? null,
  ai_summary_cleansed_bytes: data.aiSummaryCleansedBytes ?? null,
  extracted_sentences_bytes: extractedSentencesBytes ?? null,
  extracted_sentences_original_bytes: extractedSentencesOriginalBytes ?? null,
  fallback_triggered: data.fallbackTriggered ? 1 : 0,
};
```

## Offscreen / OPFS Worker の更新

### sqlite.ts

- `insert()`: Preparestatement のバインド変数とカラムリストに新規カラムを追加
- `update()`: SET 句に新規カラムを追加
- `ALLOWED_ORDER_COLUMNS`: 配列に新しいカラム名を追加
- FTS5 トリガー: content は FTS5 検索対象に含めない（肥大化防止）

### opfsWorker.ts

- `handleInsert()` / `handleUpdate()`: sqlite.ts と同じく新規カラム対応
- `handleOpenDatabase()`: ALTER TABLE マイグレーションを追加

## セキュリティ考慮

- `ALLOWED_ORDER_COLUMNS` に新しいカラム名を追加することで ORDER BY インジェクションを防止
- 新規カラムは全て TEXT または INTEGER 型で、SQL インジェクションのリスクは低い

## テスト計画

| テスト種別 | 対象 | 内容 |
|-----------|------|------|
| 単体 | schema.sql | ALTER TABLE マイグレーションがエラーなく実行される |
| 単体 | sqlite-types | BrowsingLogRecord の型拡張テスト |
| 統合 | sqlite.ts | 新規カラム含む insert → select → update の一貫性 |
| 統合 | opfsWorker.ts | OPFS Worker パスでも同様の一貫性 |
| 統合 | RecordingPipeline | createSaveSqliteStep が context から全フィールドを抽出する |
| 統合 | saveSqliteStep | モック SQLiteClient に全フィールドが渡される |

## この PBI の範囲外

- content の保存（PBI-3）
- ダッシュボード UI の修正（PBI-2）
- content 保持ポリシー（PBI-3）
- レガシーストレージからの読み出し削除（将来の別 PBI）
- `ALLOWED_ORDER_COLUMNS` で ORDER BY 可能にするかは判断保留（新規カラムでのソートはユーザー価値が低い）
