# PBI: ローカル Markdown フォルダへの直接書き出し

- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 領域: C. 連携拡張
- type: feat / 優先度: ★推奨（第一弾候補・依存少）

## ユーザーストーリー

Obsidian の Local REST API を導入していない利用者として、履歴を日次 Markdown としてローカルフォルダに書き出したい。なぜなら、REST API のセットアップが障壁で、それがなくても記録を Markdown で残せると導入のハードルが下がるから。

## ビジネス価値

Obsidian REST 未導入層に届き、対象ユーザーを拡大する。既存の整形ロジックを流用でき低コスト。測定: ローカル書き出し利用者数。

## BDD受け入れシナリオ

```gherkin
Scenario: 履歴が日次Markdownとして書き出される
  Given ローカルMarkdown書き出しが有効に設定されている
  When  ページが記録される
  Then  日付ベースのMarkdownファイルへ追記される
  And   既存のObsidian整形と同じ書式で出力される

Scenario: REST APIが無効でもローカル出力は動作する
  Given Obsidian Local REST API が設定されていない
  And   ローカルMarkdown書き出しが有効
  When  ページが記録される
  Then  ローカルMarkdownへの書き出しが行われる
  And   REST未設定でエラーにならない
```

## 受け入れ基準

- [ ] 日次 Markdown ファイルへ追記する
- [ ] 既存 `obsidianFormatter` と同一書式で出力する
- [ ] REST 未設定でも独立して動作する
- [ ] 出力先フォルダを設定できる

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 書き出し有効 → 記録 → ローカルMarkdownに追記される

### 統合テスト
- 整形ロジック → ファイル書き出しの連携
- 日付ロールオーバー時の新ファイル生成

### 単体テスト
- ファイル名/パス生成
- 追記フォーマット（`obsidianFormatter` 流用の検証）

## 実装アプローチ

Outside-In / Red-Green-Refactor。出力先だけ差し替え、整形は再利用。

## 見積もり

5pt（要チーム見積もり）

## 技術的考慮事項

- 依存: なし
- 再利用: `src/dashboard/obsidianFormatter.ts`（整形をそのまま利用）
- 出力手段: `chrome.downloads` または File System Access API。追記可否・権限フローが異なるため設計時に選定する

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rni "downloads\|FileSystem\|showSaveFilePicker\|ローカル出力" src/
grep -rn "format" src/dashboard/obsidianFormatter.ts
```

### 落とし穴

- `chrome.downloads` は「追記」が苦手（都度ダウンロード）。File System Access API は権限の永続化（`chrome.storage` にハンドル保持不可）に制約がある。どちらを採るかで UX が大きく変わるため設計判断を先に固める。

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新
