# PBI: 既存データの自動マイグレーション（chrome.storage.local → SQLite）

## ユーザーストーリー
**既存のobsidian-weaveユーザーとして**、yasumaroにアップデートした際に過去のブラウジング履歴が自動でSQLiteに移行されてほしい、なぜならこれまで蓄積したデータを失いたくないから。

## ビジネス価値
- 既存ユーザーのデータ継続性を保証し、アップデートによる離脱を防ぐ
- 移行失敗時の安全策（ロールバック可能な設計）でユーザー信頼を維持する

---

## BDD受け入れシナリオ

```gherkin
Feature: 既存データの自動マイグレーション

Scenario: 初回起動時に既存データが自動移行される
  Given obsidian-weaveの chrome.storage.local に500件の履歴データが存在する
  When yasumaroが初めて起動される（拡張機能のonInstalled または onStartup）
  Then 500件全てがSQLiteの browsing_logs テーブルに挿入される
  And マイグレーション完了フラグが chrome.storage.local に保存される
  And 元のchrome.storage.localデータはそのまま残る（削除しない）

Scenario: マイグレーション済み環境では再実行しない
  Given マイグレーション完了フラグが chrome.storage.local に存在する
  When 拡張機能が再起動される
  Then マイグレーション処理はスキップされる
  And SQLiteへの重複挿入は発生しない

Scenario: マイグレーション中にエラーが発生した場合
  Given chrome.storage.local に300件のデータがある
  When マイグレーション中の150件目でエラーが発生する
  Then エラーがログに記録される
  And マイグレーション完了フラグは保存されない（次回再試行可能）
  And 移行済みの149件はSQLiteに残る（部分的に移行済み）

Scenario: chrome.storage.localに既存データがない（新規ユーザー）
  Given chrome.storage.local にブラウジング履歴が存在しない
  When yasumaroが起動される
  Then マイグレーション処理は何もせずスキップされる
  And マイグレーション完了フラグは「新規インストール」として保存される
```

---

## 受け入れ基準
- [ ] `StorageKeys.YASUMARO_MIGRATION_STATUS` キーでマイグレーション状態を管理する
- [ ] 移行対象: 既存の `allowed_urls` / `url_contents` などのストレージキーを網羅する
- [ ] バッチ処理（100件ずつ）で大量データ移行時のメモリ圧迫を防ぐ
- [ ] Service Worker再起動をまたいでも移行が継続できる（進捗を保存する）
- [ ] 移行完了後にポップアップ経由でユーザーへ通知する
- [ ] 移行済みデータ件数をダッシュボードで確認できる

---

## テスト戦略（t_wadaスタイル）

### E2Eテスト（手動確認）
- 旧データをchrome.storage.localに手動セットして拡張機能を再起動し、SQLiteに移行されることを確認

### 統合テスト
- `MigrationService.run()` がchrome.storage.localからデータを読み取りSQLiteに挿入する
- 途中失敗時に完了フラグが立たないこと
- 既存フラグがある場合はスキップされること

### 単体テスト
- 旧データ形式から新スキーマへの変換ロジック（型変換・NULL処理）
- バッチサイズ境界値（ちょうど100件、101件）
- 不正データのスキップ処理（URL未定義など）

---

## 実装アプローチ
- **Outside-In**: `MigrationService`の統合テストを先に書いてから実装する
- **依存関係**: Phase 1（SQLiteコア基盤）が完了していること

---

## 見積もり
**5ストーリーポイント**

---

## 技術的考慮事項
- 依存関係: Phase 1（SQLite基盤）完了が前提
- 既存の `migrateToSingleSettingsObject()` パターンを参考にすること（`src/utils/storage.ts`）
- Service Workerは随時終了するため、移行状態は必ずchrome.storage.localに永続化すること

---

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "migrateToSingle\|MIGRATION\|migration" src/
grep -rn "allowed_urls\|url_contents\|StorageKeys" src/utils/storage.ts
```

### 旧データのストレージ構造（確認必須）
```typescript
// 現在のchrome.storage.localのキー構造を把握してから実装すること
// src/utils/storage.ts の StorageKeys enum を参照
```

### 実装手順
1. `src/background/migrationService.ts` を新規作成
2. `service-worker.ts` の `onInstalled` / `onStartup` で `MigrationService.run()` を呼ぶ
3. バッチ処理: `chrome.storage.local.get()` → 100件ずつ `SQLITE_INSERT` メッセージ送信

### 落とし穴
- Service Workerは5分で休眠するため、長時間の移行は `chrome.alarms` を使って分割実行すること
- `chrome.storage.local.get(null)` で全キーを取得できるが、設定データと履歴データが混在するため、対象キーを明示的に列挙すること

---

## Definition of Done
- [ ] 全BDDシナリオが自動テストとしてパスする
- [ ] `npm run type-check` 通過
- [ ] コードレビュー完了
- [ ] 既存機能（Obsidian連携・AI要約）がリグレッションしない
- [ ] 500件のデータ移行が30秒以内に完了する（性能要件）
