# PBI: ローカル Markdown フォルダへの直接書き出し

- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 領域: C. 連携拡張
- type: feat / 優先度: ★推奨（第一弾候補・依存少）
- ステータス: **完了**（2026-07-04）

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

- [x] 日次 Markdown ファイルへ追記する
- [x] 既存 `obsidianFormatter` と同一書式で出力する
- [x] REST 未設定でも独立して動作する
- [x] 出力先フォルダを設定できる

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

- [x] 全BDDシナリオが自動テスト化されパスする
- [x] カバレッジ基準を満たす
- [x] コードレビュー / リファクタ完了
- [ ] ドキュメント更新

---

## 実装記録（2026-07-04 完了）

### 設計判断

- **出力手段**: `chrome.downloads` + `conflictAction: 'overwrite'` で日次ファイルを上書き
- **日次バッファ**: `chrome.storage.local` に `local_export_YYYY-MM-DD` キーで蓄積
- **パイプライン組み込み**: Step 9 として新規追加（BEST_EFFORT 戦略）
- **Obsidian との関係**: 独立動作、両方有効可能

### 新規ファイル

| ファイル | 役割 | 行数 |
|---------|------|------|
| `src/background/pipeline/steps/saveLocalMarkdownStep.ts` | パイプラインステップ | 105 |
| `src/background/pipeline/steps/__tests__/saveLocalMarkdownStep.test.ts` | テスト（15件） | 195 |

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/utils/storage/types.ts` | StorageKeys 2件追加 + StorageKeyValues 型定義追加 |
| `src/utils/storage/defaults.ts` | デフォルト値追加（enabled: false, path: 'Yasumaro'） |
| `src/background/pipeline/steps/index.ts` | 新ステップのエクスポート追加 |
| `src/background/pipeline/RecordingPipeline.ts` | ステップ配列に新ステップ挿入 + buildResult に localMarkdownDuration 追加 |
| `src/background/pipeline/types.ts` | RecordingContext に localMarkdownDuration 追加 |
| `src/messaging/types.ts` | RecordingResult に localMarkdownDuration 追加 |
| `public/_locales/en/messages.json` | i18n キー 7件追加 |
| `public/_locales/ja/messages.json` | i18n キー 7件追加 |

### ストレージキー

| StorageKey | 型 | デフォルト | 説明 |
|-----------|-----|-----------|------|
| `local_markdown_export_enabled` | boolean | `false` | ローカル書き出し有効フラグ |
| `local_markdown_export_path` | string | `'Yasumaro'` | ダウンロードフォルダ名 |

### テスト結果

- 型チェック: パス
- テスト: 5951 passed, 18 skipped（新規15件含む）
- ビルド: 成功

### 残タスク

1. ~~ダッシュボードに設定UIを追加（トグル + パス入力）~~ ← **2026-07-04 完了**
2. ドキュメント更新（CHANGELOG.md, README.md）
3. マニュアルテスト（Chrome拡張機能として読み込んで動作確認）

### 設定UI実装記録（2026-07-04 完了）

**実装内容**: ダッシュボードの初期設定パネルに「ローカル Markdown 書き出し」セクションを追加

**変更ファイル**:
| ファイル | 変更内容 |
|---------|---------|
| `entrypoints/options/index.html` | 初期設定パネルにトグル + パス入力フィールドを追加 |
| `src/dashboard/dashboard.ts` | DOM要素参照、設定マッピング、トグルイベントリスナー、初期状態同期を追加 |
| `public/_locales/en/messages.json` | i18n キー（既に追加済み） |
| `public/_locales/ja/messages.json` | i18n キー（既に追加済み） |

**UI動作**:
- トグル ON/OFF でパス入力フィールドの表示/非表示を切り替え
- 設定保存時 `local_markdown_export_enabled` と `local_markdown_export_path` が `chrome.storage.local` に保存
- ダッシュボード初期化時に保存値を読み込み、トグル状態とパス入力に復元
