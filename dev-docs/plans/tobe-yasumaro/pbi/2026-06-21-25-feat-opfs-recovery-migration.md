# PBI-25: OPFS 復旧時の自動マイグレーション

## ユーザーストーリー

モバイル Chrome で OPFS が利用不可のため `chrome.storage.local` フォールバックを使っているユーザーとして、ブラウザがアップグレードされて OPFS が使えるようになった際に、自動でデータが SQLite に移行してほしい。なぜなら、手動でデータを移行するのは面倒だから。

## ビジネス価値

- モバイルユーザーのデータ損失リスクを排除
- OPFS 対応ブラウザへの無感覚な移行を実現
- フォールバック→本番ストレージへのシームレスなアップグレード体験

## BDD 受け入れシナリオ

```gherkin
Scenario: OPFS が復旧した際に自動マイグレーションが実行される
  Given ユーザーがフォールバックモード（chrome.storage.local）で運用している
  When ブラウザがアップグレードされて OPFS が利用可能になる
  And 拡張機能が起動する
  Then OPFS が利用可能であることが検出される
  And `chrome.storage.local` のデータが SQLite に自動移行される
  And 移行後、フォールバックモードが無効化される

Scenario: 移行中にエラーが発生した場合
  Given マイグレーションが進行中である
  When エラーが発生した場合
  Then エラーログが記録される
  And フォールバックモードが維持される（データ損失なし）
  And 次回起動時にリトライされる

Scenario: 既に OPFS で運用している場合はスキップ
  Given ユーザーがすでに OPFS で SQLite を使用している
  When 拡張機能が起動する
  Then マイグレーションは実行されない
```

## 受け入れ基準

- [ ] 起動時に OPFS の利用可能性を検出する
- [ ] フォールバックモード中のデータ（`chrome.storage.local`）を SQLite に変換する
- [ ] 既存の `migrationService.ts` を拡張し、OPFS→SQLite パスを追加
- [ ] 移行中にエラーが発生してもフォールバックモードを維持
- [ ] 移行完了後に `OPFS_FALLBACK_MODE` フラグをクリア
- [ ] 移行済みデータの重複排除（`INSERT OR IGNORE`）

## テスト戦略（t_wada スタイル）

### 単体テスト
- OPFS 利用可能性の検出ロジック
- `chrome.storage.local` → SQLite 変換関数
- エラー発生時のフォールバック維持

### 手動確認
- モバイル Chrome でのフォールバック→OPFS 移行

## 実装アプローチ

- `src/background/migrationService.ts` に OPFS→SQLite 移行パスを追加
- `src/background/service-worker.ts` の起動時処理で OPFS 検出＋移行トリガー
- `StorageKeys.OPFS_FALLBACK_MODE` が `true` の場合のみ移行実行

## 見積もり

**5 ストーリーポイント**

## Definition of Done

- [ ] OPFS 復旧時に自動マイグレーションが実行される
- [ ] エラー時もデータ損失がない
- [ ] テストがパスする
