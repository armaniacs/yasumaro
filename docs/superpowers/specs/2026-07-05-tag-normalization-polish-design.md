# Tag Normalization Polish — i18n, FTS5 Tag Search, CSS

Date: 2026-07-05

## Overview

完了一覧性を高めるために、前回実装したタグ正規化機能に対して3つの追加工事を行う。

---

## 1. i18n Messages (9 keys)

### Problem

コード上で参照されている9つのi18nメッセージキーが `public/_locales/ja/messages.json` と `public/_locales/en/messages.json` に未定義。

### Keys to Add

| Key | ja | en | Used In |
|-----|----|----|---------|
| `tagFilterLabel` | `フィルター:` | `Filter:` | sqliteHistoryPanel.ts (filter bar) |
| `clearTagFilter` | `クリア` | `Clear` | sqliteHistoryPanel.ts (filter bar button) |
| `noNormEntries` | `ルールがありません` | `No rules configured` | index.html (normalization section) |
| `normEntriesTitle` | `正規化ルール` | `Normalization Rules` | index.html (normalization section) |
| `tagNormalizationTitle` | `タグ正規化` | `Tag Normalization` | index.html (normalization section) |
| `tagNormalizationDesc` | `記録時に類似タグを自動的に正規化します（例: 「人工知能」→「AI」）。以下でルールを設定してください。` | `Automatically normalize similar tags (e.g., "人工知能" → "AI") when recording pages. Configure rules below.` | index.html (normalization description) |
| `normFromPlaceholder` | `元のタグ` | `Original tag` | index.html (from input) |
| `normToPlaceholder` | `正規化後のタグ` | `Normalized tag` | index.html (to input) |
| `duplicateNormEntryError` | `このFrom値は既に登録されています` | `This value is already registered` | tagsPanel.ts (duplicate validation) |

### Implementation

両方の `messages.json` ファイルの末尾に9エントリずつ追加。JSON構造は既存エントリに合わせる:
```json
"keyName": {
    "message": "翻訳文字列"
}
```

---

## 2. FTS5 Server-Side Tag Filter

### Problem

現在のタグフィルタはクライアントサイド（表示中の20件のみフィルタ）。ページネーションと正しく連動するサーバーサイドフィルタが必要。

### Design Decision

FTS5 MATCH方式を採用（ユーザー選択）。LIKEではなくトリグラムFTS5インデックスを利用してtags列を検索する。

### Architecture

```
User clicks tag badge "AI"
  → sqliteHistoryPanel: loadData({ tagFilter: "AI" })
    → dashboardSqliteService: queryLogs({ tagFilter: "AI", ... })
      → handleDashboardSqlite: sqliteClient.query({ tagFilter, ... })
        → offscreen (IDB or OPFS): SQL with FTS5 MATCH on tags column
```

### Data Flow

`QueryOptions` に `tagFilter?: string` を追加。既存の `since`, `until`, `domain` フィルタと同列の条件として扱う。

SQL生成（IDB `sqlite.ts` / OPFS `opfsWorker.ts` の両方）:
```sql
-- tagFilter = "AI" の場合
AND id IN (SELECT rowid FROM browsing_logs_fts WHERE tags MATCH '"#AI"')
```

- FTS5マッチ式は `"#タグ名"` とクォートで囲む（exact phrase match、トリグラムトークナイザ対応）
- tagFilter 値はユーザーがクリックしたタグ名（#なし）をそのまま渡す
- 既存の日付・検索フィルタとはANDで結合する

### Filter Interaction (AND)

`searchLogs()` と `queryLogs()` の両方に `tagFilter` を追加。`loadData()` で以下のように使い分ける:

- **searchなし**: `queryLogs({ limit, offset, since, until, tagFilter })` — 日付 + tagFilter
- **searchあり**: `searchLogs(query, limit, offset, { tagFilter })` — FTS5全文検索 + tagFilterを追加条件として適用

| Search | Date | TagFilter | Behavior |
|--------|------|-----------|----------|
| - | - | AI | queryLogs with tagFilter only |
| - | today | AI | queryLogs with date range + tagFilter |
| "keyword" | - | AI | searchLogs with query + tagFilter |
| "keyword" | today | AI | searchLogs with query + date range + tagFilter |

### File Changes

| File | Change |
|------|--------|
| `src/utils/sqlite-types.ts` | Add `tagFilter?: string` to `QueryOptions` |
| `src/offscreen/opfsWorker.ts` | Add `tagFilter` to `QueryPayload`; add FTS5 condition in `handleQuery()` |
| `src/offscreen/sqlite.ts` | Add `tagFilter` to `query()` SQL builder |
| `src/dashboard/dashboardSqliteService.ts` | Add `tagFilter` param to `queryLogs()` options |
| `src/background/handlers/dashboardSqliteHandlers.ts` | Forward `tagFilter` to `sqliteClient.query()` |
| `src/dashboard/sqliteHistoryPanel.ts` | Rewrite tag filter: badge click → `loadData({ tagFilter })` triggers server-side reload. `activeTagFilter` state remains for UI highlighting (filter bar + badge `.filter-active` class). Client-side filter in `renderEntryList()` replaced with server-side. |

### FTS5 Sanitization

FTS5クエリ構文の無効な文字（`^` `*` `"`など）をサニタイズする必要がある。タグ名にこれらの文字が含まれるケースは稀だが、安全のため既存の `sanitizeFtsTerm()` 関数を流用する。

---

## 3. CSS Styling

### Problem

前回の実装で追加したHTMLクラスに対応するCSSが `dashboard.css` に未定義。UIが正しく表示されない。

### Styles to Add

All new styles are added to `entrypoints/options/dashboard.css`, following existing patterns.

#### Tag Badges in SQLite Entries

```css
.sqlite-entry-tags {
  /* Same as .tag-badges: flex wrap, gap, margin */
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
  margin-top: var(--space-1);
  padding: 0 12px 8px; /* horizontal padding matching entry content */
}
```

既存の `.tag-badge` / `.tag-badge.filter-active` クラスはそのまま使う（legacy panelから流用）。

#### Tag Filter Bar

```css
.sqlite-tag-filter-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  margin-top: 4px;
  background: var(--color-primary-bg);
  border: 1px solid var(--color-primary-border);
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.tag-filter-badge {
  /* Same style as .tag-badge but non-interactive */
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  color: #6b21a8;
  background: var(--color-primary-bg);
  border: 1px solid var(--color-primary-border);
}

.tag-filter-clear {
  /* Same as .user-category-delete */
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--color-text-muted);
  padding: 0 4px;
  line-height: 1;
}
.tag-filter-clear:hover {
  color: var(--color-danger);
}
```

#### Normalization Dictionary Entries

```css
.norm-entries-list {
  /* Same as .tag-categories-user-list */
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.norm-entry-item {
  /* Same as .user-category-item */
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.norm-entry-label {
  font-size: 13px;
  color: var(--color-text);
}

.norm-entry-delete {
  /* Same as .user-category-delete */
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  color: var(--color-text-muted);
  padding: 2px 6px;
  line-height: 1;
}
.norm-entry-delete:hover {
  color: var(--color-danger);
}

.norm-arrow {
  display: inline-flex;
  align-items: center;
  padding: 0 8px;
  color: var(--color-text-muted);
  font-size: 14px;
  user-select: none;
}

.norm-input {
  /* Uses existing .w-full, just indicating intent */
}
```

### Dark Mode

既存の `.tag-badge` と同様に、ダークモードでは `.tag-filter-badge` も `prefers-color-scheme: dark` メディアクエリで色反転する。

---

## Implementation Order

1. i18n messages (両方の locale ファイル)
2. CSS styles (dashboard.css)
3. FTS5 tag filter (バックエンド → フロントエンドの順)

---

## Test Strategy

### i18n
- 既存テストに影響なし。変更はJSONのみ。

### CSS
- 目視確認（テスト環境の制約上、CSSはブラウザで確認）。

### FTS5 Tag Filter
- `dashboardSqliteService.test.ts` に `queryLogs({ tagFilter })` 呼び出しのテスト追加。
- `dashboardSqliteHandlers.test.ts` にtagFilter付きクエリの転送テスト追加。
- 手動でSQLite履歴パネルを開き、タグバッジクリック → 正しくフィルタされることを確認。
