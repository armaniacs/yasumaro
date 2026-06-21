# PBI-24: `.db` バイナリエクスポート・インポート

## ユーザーストーリー

複数デバイスで Yasumaro を使用しているユーザーとして、ブラウジング履歴を別のデバイスに移行したい。なぜなら、デバイスを買い替えた際にデータが失われるのを防ぎたいから。

## ビジネス価値

- データのポータビリティを提供し、ユーザーの安心感を向上
- バックアップ/リストア機能として活用可能
- 競合他社（Raindrop.io、Pocket）との差別化要因

## BDD 受け入れシナリオ

```gherkin
Scenario: SQLite データベースをバイナリでエクスポートする
  Given ユーザーがダッシュボードのエクスポート設定を開いている
  When 「.db エクスポート」ボタンを押す
  Then `yasumaro-YYYY-MM-DD.db` ファイルがダウンロードされる
  And ファイルには全閲覧履歴・スター情報・設定が含まれている

Scenario: バイナリデータベースをインポートする
  Given ユーザーが別のデバイスで Yasumaro を使用している
  When ダッシュボードで .db ファイルを選択してインポートする
  Then 重複レコード（URL + created_at）はスキップされ（INSERT OR IGNORE）
  And 新規レコードのみ追加される

Scenario: インポート時にデータ整合性が保たれる
  Given インポート元と先のデータベースに重複するレコードが存在する
  When インポートを実行する
  Then 既存レコードは変更されない
  And 追加された件数が通知で表示される
```

## 受け入れ基準

- [ ] `sqlite3_serialize` を使用したバイナリエクスポート機能を実装
- [ ] インポート時に `INSERT OR IGNORE` で重複排除（`UNIQUE(url, created_at)` 制約に依存）
- [ ] エクスポートファイル名に日付を含める（`yasumaro-YYYY-MM-DD.db`）
- [ ] インポート件数の通知表示
- [ ] エクスポート時に FTS5 インデックスも含める
- [ ] 大きなデータベース（100MB+）でも動作することを確認

## テスト戦略（t_wada スタイル）

### 単体テスト
- `sqlite3_serialize` の出力が有効な SQLite ファイル形式であること
- インポート時の重複排除ロジック
- 空データベースのエクスポート/インポート

### 手動確認
- 別デバイスへのデータ移行
- 大きなデータベースでのパフォーマンス

## 実装アプローチ

- `src/offscreen/sqlite.ts` に `exportDatabase()` / `importDatabase()` を追加
- `sqlite3_serialize()` / `sqlite3_deserialize()` を使用
- offscreen document 経由でバイナリデータを返す
- Dashboard 側で `Blob` + `URL.createObjectURL` でダウンロード

## 見積もり

**5 ストーリーポイント**

## Definition of Done

- [ ] .db エクスポートが動作する
- [ ] .db インポートが重複排除付きで動作する
- [ ] テストがパスする
