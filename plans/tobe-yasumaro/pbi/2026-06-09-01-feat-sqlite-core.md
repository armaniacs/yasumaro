# PBI: SQLiteコア基盤の構築（wa-sqlite + OPFS + FTS5）

## ユーザーストーリー
**Chrome拡張ユーザーとして**、Obsidianがインストールされていない環境でも、ブラウジング履歴とAI要約がローカルのSQLiteデータベースに永続保存されてほしい、なぜなら外部サービスに依存せず自分のデータを手元に保持したいから。

## ビジネス価値
- Obsidianインストール不要になり、ユーザー獲得の障壁が大幅低下する
- chrome.storage.localの容量制限（10MB）を突破し、無制限蓄積が可能になる
- FTS5による全文検索で、過去のブラウジング履歴を高速に呼び出せる

---

## BDD受け入れシナリオ

```gherkin
Feature: SQLite OPFS永続化

Scenario: ブラウジング記録がSQLiteに保存される
  Given Chrome拡張がインストールされており、Offscreen DocumentでSQLiteが初期化済みである
  When Service Workerがブラウジング記録（URL、タイトル、AI要約）をDBに保存する
  Then OPFSの yasumaro.db ファイルに1件のレコードが挿入されている
  And chrome.storage.localには保存されていない

Scenario: FTS5で全文検索が動作する
  Given SQLiteに10件のブラウジング記録が保存されている
  When "TypeScript" というキーワードで全文検索を実行する
  Then タイトルまたは要約に "TypeScript" を含むレコードのみが返される
  And 検索結果は関連度順にソートされている

Scenario: SQLite初期化に失敗した場合のフォールバック
  Given OPFSへのアクセスが何らかの理由で失敗する
  When Service WorkerがSQLite初期化を試みる
  Then エラーがログに記録される
  And ユーザーへのエラー通知が表示される（記録は失敗として扱う）
```

---

## 受け入れ基準
- [ ] wa-sqliteライブラリがOffscreen Document内で正常にロードされる
- [ ] OPFSバックエンド（`opfs-sahpool`）でSQLiteファイルが永続化される
- [ ] 以下のスキーマが作成される:
  ```sql
  CREATE TABLE browsing_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    title TEXT,
    summary TEXT,
    tags TEXT,          -- JSON array as text
    created_at INTEGER NOT NULL,  -- Unix timestamp
    domain TEXT,
    visit_duration INTEGER,
    scroll_ratio REAL,
    is_starred INTEGER DEFAULT 0,
    is_deleted INTEGER DEFAULT 0
  );
  CREATE VIRTUAL TABLE browsing_logs_fts USING fts5(
    url, title, summary, tags,
    content='browsing_logs', content_rowid='id'
  );
  ```
- [ ] Service Worker ↔ Offscreen Document間のメッセージパッシングで CRUD が動作する
- [ ] FTS5検索が動作し、50ms以内に結果が返る（10万件想定）
- [ ] `manifest.json`に `"offscreen"` パーミッションが含まれている（確認済み: 既に存在）
- [ ] `manifest.json`に `"unlimitedStorage"` パーミッションが含まれている（確認済み: 既に存在）

---

## テスト戦略（t_wadaスタイル）

### E2Eテスト（手動確認）
- Chrome拡張をロードし、ページを閲覧後タブを閉じると `yasumaro.db` に記録が追加される
- Chrome DevTools → Application → Storage → Origin Private File System で確認

### 統合テスト（Offscreen Document ↔ Service Worker）
- `SQLITE_INIT` メッセージを送り、初期化成功レスポンスが返ること
- `SQLITE_INSERT` メッセージでレコードが挿入されること
- `SQLITE_SEARCH` メッセージで全文検索結果が返ること
- `SQLITE_QUERY` で件数が返ること

### 単体テスト
- SQLiteMessageHandler: 各メッセージタイプのルーティングが正しい
- スキーマ定義: テーブル作成SQLが構文エラーなく実行できる
- FTS5トリガー: INSERT後にFTSテーブルが自動更新される

---

## 実装アプローチ
- **Outside-In**: Offscreen Document初期化の統合テストから開始
- **Red-Green-Refactor**: メッセージパッシングのI/Fを固めてから内部実装

---

## 見積もり
**8ストーリーポイント**（技術的不確実性あり。wa-sqliteのOPFS設定に0.5〜1スプリント追加の可能性あり）

---

## 技術的考慮事項
- **wa-sqlite選定理由**: SQLite公式WasmはCOOP/COEPヘッダーが必要でChrome拡張では設定困難。wa-sqliteは`opfs-sahpool`バックエンドでその制約を回避できる
- **Offscreen Documentの制約**: 1拡張機能につき1つのみ存在可能。既存の `src/offscreen/offscreen.ts` を拡張して共存させること
- **Workerは不要**: `opfs-sahpool`はOffscreen Document（通常のWebコンテキスト）で動作するためWeb Workerは不要
- **メッセージ型**: `src/background/messageTypes.ts` に SQLite用メッセージ型を追加すること

---

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）
```bash
grep -rn "wa-sqlite\|opfs\|OPFS\|sqlite" src/
grep -rn "offscreen" src/background/service-worker.ts
cat src/offscreen/offscreen.ts
```

### 実装手順

1. **wa-sqliteのインストール**
   ```bash
   npm install wa-sqlite
   ```

2. **メッセージタイプの追加** (`src/background/messageTypes.ts`)
   ```typescript
   export const SQLITE_MESSAGE_TYPES = [
     'SQLITE_INIT', 'SQLITE_INSERT', 'SQLITE_QUERY',
     'SQLITE_SEARCH', 'SQLITE_DELETE', 'SQLITE_EXPORT'
   ] as const;
   ```

3. **SQLiteクライアント作成** (`src/background/sqliteClient.ts`)
   - Offscreen DocumentへのメッセージをラップするクライアントクラスT

4. **Offscreen Document拡張** (`src/offscreen/offscreen.ts`)
   - wa-sqlite + opfs-sahpool の初期化
   - メッセージハンドラの追加

5. **manifest.json確認**
   ```json
   "permissions": ["offscreen", "unlimitedStorage", ...]
   ```
   (2026-06-09 時点で両パーミッションは既に存在するため追加不要。確認のみ)

### 落とし穴
- Offscreen Documentは `chrome.offscreen.createDocument()` で既に作成されている場合はスキップすること（既存コードを確認）
- `opfs-sahpool`の初期化は非同期で、完了前にSQLクエリを発行するとエラーになる。初期化完了を確実に待つこと
- FTS5のコンテンツテーブル更新はトリガーで行う（`after insert/update/delete`）

---

## Definition of Done
- [ ] 全BDDシナリオが自動テスト（統合テスト）としてパスする
- [ ] 単体テストが追加されカバレッジが維持される
- [ ] TypeScriptの型エラーがゼロ（`npm run type-check` 通過）
- [ ] コードレビュー完了
- [ ] 既存の obsidian-weave 機能（Obsidian連携）が引き続き動作する（リグレッションなし）
- [ ] CLAUDE.md に SQLite関連アーキテクチャを追記
