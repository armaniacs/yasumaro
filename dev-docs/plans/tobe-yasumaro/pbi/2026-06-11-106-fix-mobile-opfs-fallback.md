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
- [ ] `navigator.storage?.getDirectory()`でOPFS利用可否を事前チェック
- [ ] OPFS未対応時にchrome.storage.localベースのストレージを実装
- [ ] フォールバックモードの警告表示
- [ ] FTS5なしでの検索機能（线性探索）
- [ ] OPFS復旧時のデータマイグレーション
- [ ] モバイルChromeでのE2Eテスト

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

### 落とし穴
- chrome.storage.localの容量制限（5MB）→ 古いデータから削除
- FTS5なしでの検索は遅い→ページネーション必須
- OPFS復旧の検出方法（定期チェック or 起動時チェック）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] モバイルChromeでの動作確認
