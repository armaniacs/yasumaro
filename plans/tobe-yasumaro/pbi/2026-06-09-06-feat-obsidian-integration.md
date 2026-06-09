# PBI: Obsidian連携の維持・強化（SQLite移行後のハイブリッド動作）

## ユーザーストーリー
**Obsidianユーザーとして**、yasumaroにアップグレードした後も、Obsidianが起動していれば自動的にデイリーノートへ記録が流し込まれてほしい、なぜならObsidianを主要な知識ベースとして使っており、これまでのワークフローを維持したいから。

## ビジネス価値
- 既存obsidian-weaveユーザーのアップデート後の離脱を防ぐ
- SQLite（一次記録）とObsidian（知識ベース）のハイブリッド構成で、両方のメリットを享受できる

---

## BDD受け入れシナリオ

```gherkin
Feature: Obsidian連携ハイブリッド動作

Scenario: Obsidian起動中は自動的にデイリーノートへ流し込まれる
  Given Obsidian Local REST APIが起動しており、接続設定が完了している
  And ブラウジングログがSQLiteに保存された
  When Service WorkerがObsidian REST APIへの接続を試みる
  Then SQLiteへの保存と同時にObsidianのデイリーノートへも記録が追記される

Scenario: Obsidianが起動していない場合はSQLiteのみに保存される
  Given Obsidian Local REST APIが起動していない（または応答なし）
  When ブラウジングログがSQLiteに保存される
  Then SQLiteへの保存は成功する
  And Obsidian連携はエラーなくスキップされる（ログには記録する）
  And ユーザーへのエラー通知は表示されない（サイレントスキップ）

Scenario: ダッシュボードからObsidian未送信ログを手動で送信する
  Given Obsidianへの送信に失敗したログがSQLiteに3件存在する
  When ユーザーがダッシュボードで「Obsidianへ再送信」ボタンをクリックする
  Then 3件がObsidianのデイリーノートへ送信される
  And 送信成功したログの obsidian_synced フラグが1に更新される

Scenario: Obsidian接続設定をダッシュボードでテストできる
  Given ダッシュボードの設定画面でObsidian REST APIのURLとポートを入力した
  When 「接続テスト」ボタンをクリックする
  Then Obsidian REST APIの /api/v1/health エンドポイントにリクエストを送り
  And 成功なら「接続成功」、失敗なら「接続失敗: <エラー理由>」が表示される
```

---

## 受け入れ基準
- [ ] 既存の `src/background/obsidianClient.ts` の機能を全て維持する
- [ ] SQLiteスキーマに `obsidian_synced INTEGER DEFAULT 0` カラムを追加する
- [ ] Obsidian送信成功時に `obsidian_synced = 1` を更新する
- [ ] Obsidian送信失敗時はサイレントスキップ（ユーザー通知なし）
- [ ] ダッシュボードに「Obsidian未送信ログ」のフィルターと再送信ボタンを追加する
- [ ] 接続テスト機能をダッシュボードの設定画面に追加する
- [ ] Obsidianが設定されていない場合（APIキー未設定）は連携処理を完全スキップする
- [ ] i18nメッセージ（obsidian関連）を新規作成する（`_locales/` は未作成のため、`_locales/ja/messages.json` と `_locales/en/messages.json` を新規作成し、Obsidian関連メッセージを追加する）

---

## テスト戦略（t_wadaスタイル）

### E2Eテスト（手動確認）
- Obsidianを起動した状態でページを閲覧し、デイリーノートへの自動記録を確認
- Obsidianを停止した状態でページを閲覧し、SQLiteのみに記録されることを確認

### 統合テスト
- `ObsidianSyncService.sync(log)` がObsidian API成功時に `obsidian_synced=1` を更新する
- `ObsidianSyncService.sync(log)` がAPI失敗時にエラーをスローせずfalseを返す
- `ObsidianSyncService.getPendingLogs()` がSQLiteから未送信ログを取得する

### 単体テスト
- Obsidian API未設定時のスキップ判定
- サイレントスキップ: catch節でエラーがユーザー通知に伝播しないこと
- `obsidian_synced` フラグの更新ロジック

---

## 実装アプローチ
- **Outside-In**: `ObsidianSyncService` の統合テストから定義
- **依存関係**: Phase 1（SQLite基盤）完了が前提

---

## 見積もり
**5ストーリーポイント**（既存obsidianClientコードを大幅に流用できるため）

---

## 技術的考慮事項
- 依存関係: Phase 1（SQLite基盤）完了が前提
- 既存 `src/background/obsidianClient.ts` は修正を最小限に留め、新たに `ObsidianSyncService` クラスで `sqliteClient` との橋渡しを担当させる
- SQLiteスキーマのマイグレーション: Phase 1のスキーマに `obsidian_synced` カラムを追加するALTER TABLE

---

## 実装者向け注記

### 現状コードの確認
```bash
cat src/background/obsidianClient.ts
grep -rn "obsidian\|Obsidian" src/background/service-worker.ts
grep -rn "obsidian" src/utils/storage.ts
```

### 落とし穴
- Obsidianのローカル証明書（自己署名）に対応するための `fetchWithTimeout` の挙動を確認すること
- `obsidian_synced` の更新はSQLiteへのINSERT完了後に非同期で行う（Obsidian送信の成否でSQLite保存を失敗させてはいけない）

---

## Definition of Done
- [ ] 全BDDシナリオが自動テストとしてパスする
- [ ] `npm run type-check` 通過
- [ ] コードレビュー完了
- [ ] Obsidian起動中・停止中の両シナリオを手動確認済み
- [ ] 既存のObsidian連携設定（URL・ポート・API Key）が引き続き動作する
