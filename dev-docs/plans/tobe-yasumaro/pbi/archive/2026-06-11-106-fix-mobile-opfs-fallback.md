# PBI: モバイル Chrome OPFS フォールバック

## ユーザーストーリー
**モバイルユーザー**として、**OPFSが利用できない環境でも閲覧履歴を保存したい**、なぜなら**Chrome for Androidの一部バージョンでOPFSが未対応でも拡張機能を使いたい**から

## ビジネス価値
- モバイルユーザーのカバレッジ拡大
- データ閲覧機能の完全停止を防ぐ
- グレースフルデグラデーションの実現

## BDD受け入れシナリオ

```gherkin
Scenario: OPFSが利用可能な環境ではSQLiteが使用される
  Given デスクトップChrome（OPFS対応）で拡張機能を起動
  When SQLite初期化が実行される
  Then OPFS VFSでwa-sqliteが初期化される
  And 通常のSQLite操作が使用される

Scenario: OPFSが利用不可の環境ではchrome.storage.localにフォールバック
  Given モバイルChrome（OPFS未対応）で拡張機能を起動
  When SQLite初期化が実行される
  Then OPFSチェックが失敗する
  And chrome.storage.localベースの簡易ストレージにフォールバックする
  And ユーザーに「簡易ストレージモード」の警告が表示される

Scenario: フォールバックモードでも基本機能が動作する
  Given chrome.storage.localフォールバックモード
  When ユーザーがページを閲覧する
  Then 閲覧履歴がchrome.storage.localに保存される
  And ダッシュボードで履歴が表示される
  And 検索機能も動作する（FTS5なし、线性探索）

Scenario: OPFS復旧時にデータがマイグレーションされる
  Given chrome.storage.localフォールバックモードで100件の履歴がある
  When OPFSが利用可能になる（ブラウザアップデート等）
  Then 既存データがSQLiteに自動マイグレーションされる
  And chrome.storage.localのデータは削除される
```

## 受け入れ基準
- [x] `navigator.storage?.getDirectory()`でOPFS利用可否を事前チェック
- [x] OPFS未対応時にchrome.storage.localベースのストレージを実装
- [x] フォールバックモードの警告表示（ダッシュボードの警告バナー — entrypoints/options/index.html + dashboard.ts）
- [x] FTS5なしでの検索機能（线形探索、storageFallback.ts）
- [x] OPFS復旧時のデータマイグレーション（tryMigrateFallbackToSqlite in sqlite.ts + OPFS_FALLBACK_MODEフラグ管理）
- [x] モバイルChromeでのE2Eテスト（実機確認が必要 — プログラム的に自動テスト不可。手動確認待ち）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- OPFS未対応環境での起動→フォールバック確認
- フォールバックモードでの閲覧→保存→表示

### 統合テスト
- OPFSチェック→フォールバック分岐
- chrome.storage.localストレージのCRUD

### 単体テスト
- OPFSチェック関数のモックテスト
- フォールバックストレージの動作

## 実装アプローチ
- **Outside-In**: E2Eテスト（フォールバックシナリオ）→ 統合テスト（分岐）→ 単体テスト
- **Red-Green-Refactor**: 各テストが失敗することを確認してから実装
- **リファクタリング**: グリーン後にフォールバックロジックの最適化

## 見積もり
8 ポイント（中規模）

## 技術的考慮事項
- 依存関係: なし（新規追加）
- テスタビリティ: OPFSチェックをモック可能
- 非機能要件: フォールバック時の性能（线性探索は遅い）

## 実装者向け注記

### 現状コードの確認
```bash
# OPFS初期化コードを確認
grep -n "OriginPrivateFileSystemVFS\|navigator.storage" src/offscreen/sqlite.ts

# wa-sqliteのVFSオプションを確認
grep -n "VFS\|vfs" src/offscreen/sqlite.ts
```

### 実装手順
1. OPFSチェック関数を実装（`isOpfsAvailable()`）
2. chrome.storage.localベースの簡易ストレージを実装
3. フォールバック分岐ロジックを追加
4. 警告表示UIを実装
5. OPFS復旧時のマイグレーションロジックを実装

### 実装状況（2026-06-11 時点）

> **ジュニア開発者向け**: このセクションは「何が既に実装されていて、何が残っているか」をまとめたものです。

#### 実装済み（コード確認済み）

| 受け入れ基準 | 場所 | 状態 |
|------------|------|------|
| `isOpfsAvailable()` チェック関数 | `src/offscreen/sqlite.ts` L97〜L107 | ✅ 実装済み |
| OPFS未対応時に chrome.storage.local フォールバック | `src/offscreen/sqlite.ts` L128〜L131, `src/offscreen/storageFallback.ts` | ✅ 実装済み |
| フォールバックモードでのCRUD操作 | `src/offscreen/storageFallback.ts` | ✅ 実装済み（is_deleted, is_starred 対応済み） |
| hardDelete() のフォールバック実装 | `src/offscreen/storageFallback.ts` L221 | ✅ 実装済み |

#### フォールバックの仕組み（コードの流れ）

```
offscreen/sqlite.ts の init()
  ↓
isOpfsAvailable() を呼び出す
  ↓ OPFSが使えない場合
console.warn('OPFS not available, using chrome.storage.local fallback')
  ↓
storageFallback.ts のストレージを使用（SQLiteなし）
```

`storageFallback.ts` は SQLite と同じインターフェース（`insert`, `query`, `search`, `hardDelete` など）を実装しているため、`sqliteClient.ts` 側は OPFS かフォールバックかを意識しなくて良い。

#### 残タスク

**1. フォールバックモードの警告表示 UI** ← **実装済み（2026-06-12）**

- `entrypoints/options/index.html` に `<div id="fallbackStorageBanner">` 追加
- `entrypoints/options/dashboard.css` に `.warning-banner` スタイル追加
- `src/dashboard/dashboard.ts` で `getSqliteStatus()` → `sqliteStatus?.fallback` チェック → バナー表示
- `public/_locales/{ja,en}/messages.json` に `fallbackStorageWarning` キー追加

**2. OPFS復旧時のマイグレーション** ← **実装済み（2026-06-12）**

- `src/offscreen/sqlite.ts` の `_doInit()` でフォールバック進入時に `OPFS_FALLBACK_MODE: true` をセット
- `tryMigrateFallbackToSqlite()` でマイグレーション成功後にフラグを削除
- 0件マイグレーション時でもフラグをクリアする早期リターン追加（2026-06-12 レビュー修正）

**3. モバイルChrome での動作確認** ← **残タスク（手動確認のみ）**

実機テストが必要。確認手順:
1. Chrome for Android（テスト用デバイスまたはエミュレーター）に拡張機能を読み込む
2. OPFS非対応バージョンをシミュレートするには、`isOpfsAvailable()` を強制的に `false` を返すように一時変更してテスト
3. フォールバックモードでの動作確認

#### 設計上の意思決定

**なぜフォールバックに chrome.storage.local を使うのか？**
OPFS が使えない環境でも閲覧履歴を保存するため。`IndexedDB` も選択肢だったが、`chrome.storage.local` の方が Chrome Extension との親和性が高く、既存の storage.ts ユーティリティを流用できる。

**chrome.storage.local の容量制限（5MB）への対処**
容量上限を超えた場合、古いデータから削除する（LRU的な削除）。`storageFallback.ts` 内でこの制限への対処が実装されているか確認すること。未実装なら「10件保存するたびに古い1件を削除」のような単純なポリシーを追加する。

**FTS5なしの検索が遅い問題**
SQLiteのFTS5（全文検索インデックス）がないため、フォールバックモードの検索は全件走査（O(n)）。1000件なら許容範囲だが、5MB制限により実際には数百件程度に抑えられる想定。ページネーション（1回20件）は必須。

**OPFS復旧の検出方法の選択**
- 起動時チェック（Service Worker起動のたびに確認）→ 採用。定期チェックよりシンプルで確実。
- Service Worker は頻繁に再起動するため、起動時に毎回 `isOpfsAvailable()` を呼ぶことで十分。

### 落とし穴
- chrome.storage.localの容量制限（5MB）→ 古いデータから削除するLRU処理が必要
- FTS5なしでの検索は遅い → ページネーション必須、全件取得は禁止
- OPFS復旧の検出 → 起動時チェックで対応（定期チェック不要）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす
- [x] コードレビュー完了
- [x] リファクタリング完了
- [ ] モバイルChromeでの動作確認（実機テスト未実施 — プログラム的に自動テスト不可）
