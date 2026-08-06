# ローカル Markdown 書き出しテンプレート機能 設計

## 背景・目的

ローカル Markdown 書き出し(自動エクスポート・ダッシュボード手動エクスポート)の出力フォーマットは、現状すべてハードコードされている。調査の結果、Markdown 整形ロジックが以下 4 箇所に重複実装されていることが判明した。

| # | ファイル | 用途 |
|---|---|---|
| A | `src/background/pipeline/steps/formatMarkdownStep.ts` | 自動記録パイプライン共通の 1 エントリ整形(Obsidian・ローカル両方が使用) |
| B | `src/dashboard/obsidianFormatter.ts` | ダッシュボードから選択したエントリを手動で Obsidian へ送信 |
| C | `src/utils/markdownFormatter.ts` | ポップアップの「現在のページを記録」単発エクスポート |
| D | `src/dashboard/dashboard.ts` の `formatEntryToMarkdown()` / `downloadDateMarkdown()` | ダッシュボードの手動ローカル Markdown エクスポート(日付範囲指定・全履歴) |

見た目はほぼ同一(`- HH:MM [title](url)\n    - タグ 要約`)だが実装は別々で、フロントマターは一切なく `#` 見出し + Markdown リスト構成に固定されている。テンプレート機構は存在しない。

一方、`src/utils/customPromptUtils.ts` に AI 要約プロンプト用のカスタマイズ機構(プレースホルダー置換・CRUD・複数保存・プリセット)が既に成熟した形で存在し、これを Markdown テンプレートにも転用できる。

本設計では、**ローカル Markdown 書き出し**(自動エクスポート `saveLocalMarkdownStep.ts` + ダッシュボード手動エクスポート `dashboard.ts`)の出力フォーマットをユーザーがカスタマイズできるようにする。

## スコープ

### 対象
- 自動ローカル Markdown エクスポート(`src/background/pipeline/steps/saveLocalMarkdownStep.ts`、immediate/idle/daily の各タイミング)
- ダッシュボードの手動ローカル Markdown エクスポート(`src/dashboard/dashboard.ts` の `formatEntryToMarkdown()` / `downloadDateMarkdown()`)

上記 2 経路を単一のテンプレートレンダリングロジックに統合し、常に同じカスタムフォーマットが適用されるようにする。

### 対象外
- Obsidian への送信経路(`formatMarkdownStep.ts` によるパイプライン共通整形、`obsidianFormatter.ts` によるダッシュボード手動送信)は現状維持。
  - 理由: Obsidian 送信は `NoteSectionEditor` が既存デイリーノートのセクションを探して追記する仕組みであり、ローカル書き出し(新規ファイル生成)とはファイル全体構造の要件が異なる。ファイル全体テンプレート化は「新規ファイルを作る」ローカル書き出しのみに適用する。
  - 将来的に Obsidian 側は 1 エントリ行フォーマットのみ別途カスタマイズ可能にする余地があるが、今回のスコープには含めない。
- `src/utils/markdownFormatter.ts`(ポップアップ単発記録)は対象外。挙動は変更しない。

## テンプレート構造

**2 層構造**: ファイルテンプレートとエントリテンプレートを分離する。

1. **ファイルテンプレート**: 書き出しファイル全体の構造(フロントマター・見出しを含む)。
   - プレースホルダー: `{{date}}`(YYYY-MM-DD)、`{{entryCount}}`(その日のエントリ件数)、`{{entries}}`(エントリテンプレートのレンダリング結果を連結したもの)
2. **エントリテンプレート**: 1 件分の履歴エントリの行フォーマット。
   - プレースホルダー: `{{timestamp}}`、`{{title}}`、`{{url}}`、`{{summary}}`、`{{tags}}`、`{{domain}}`(URL のホスト名)

レンダリング処理: 各履歴エントリにエントリテンプレートを適用して整形 → 結果を連結し `{{entries}}` としてファイルテンプレートに差し込む。ループ構文などのテンプレート言語は実装せず、単純な文字列プレースホルダー置換(`customPromptUtils.ts` の `replaceContentPlaceholder` と同様の方式)とする。

## データモデル

```typescript
interface MarkdownExportTemplate {
  id: string;
  name: string;
  fileTemplate: string;   // uses {{date}} {{entryCount}} {{entries}}
  entryTemplate: string;  // uses {{timestamp}} {{title}} {{url}} {{summary}} {{tags}} {{domain}}
}
```

### Storage

- `StorageKeys.MARKDOWN_EXPORT_TEMPLATES`: `MarkdownExportTemplate[]` として複数保存
- `StorageKeys.ACTIVE_MARKDOWN_EXPORT_TEMPLATE_ID`: 選択中テンプレートの ID

### デフォルトテンプレート

固定 ID を持ち、削除・編集不可(`customPromptUtils.ts` のプリセット扱いに準拠)。現行のハードコード出力を再現する:

- `fileTemplate`: `` "# {{date}}\n\n{{entries}}" ``
- `entryTemplate`: `` "- {{timestamp}} [{{title}}]({{url}})\n    - {{tags}} {{summary}}" ``

テンプレート未設定(既存ユーザー)の場合はこのデフォルトが自動適用され、既存の出力形式は変わらない。カスタムテンプレートが欲しい場合はデフォルトを複製して編集する運用とする。

## 新規モジュール: `src/utils/markdownTemplateUtils.ts`

`customPromptUtils.ts` と対になる構成:

- `DEFAULT_MARKDOWN_TEMPLATE`: 上記デフォルトテンプレート定数
- `createTemplate` / `updateTemplate` / `deleteTemplate` / `setActiveTemplate` / `getActiveTemplate`: CRUD 関数群。デフォルトテンプレートの更新・削除は拒否する
- `renderEntryTemplate(template, entry)`: エントリ 1 件をエントリテンプレートでレンダリング
- `renderFileTemplate(template, entries, date)`: 複数エントリをレンダリングして `{{entries}}` に差し込み、ファイル全体を生成
- `validateTemplate(template)`: 以下を検査し、`{ valid: boolean, errors: string[] }` 形式で結果を返す
  - ファイルテンプレートに `{{entries}}` が含まれているか(必須。含まれない場合は `valid: false` とし保存を拒否する)
  - 定義済み以外の `{{xxx}}` プレースホルダーが含まれていないか(未知プレースホルダー検出。`valid: false` とし保存を拒否する)

サニタイズ(`src/utils/markdownSanitizer.ts`)は現行通り、プレースホルダーに差し込む各値(title・summary・url など)に対して置換前に適用し、既存の XSS/インジェクション対策を維持する。

## 既存コードの統合

以下 2 箇所のハードコード整形処理を `markdownTemplateUtils.ts` のレンダリング関数呼び出しに置き換える:

- `src/background/pipeline/steps/saveLocalMarkdownStep.ts` の `buildDailyMarkdown()`
- `src/dashboard/dashboard.ts` の `formatEntryToMarkdown()` + `downloadDateMarkdown()`

置き換え後、両経路は同一のテンプレートレンダリングロジックを共有し、アクティブなテンプレートに応じた出力を生成する。

## UI

ダッシュボードに「Markdown テンプレート」独立管理パネルを新設する(`customPromptUtils.ts` のプリセット UI パターンを踏襲)。

- テンプレート一覧表示(名前・アクティブテンプレートの表示)
- 新規作成・編集・削除(デフォルトテンプレートは編集・削除不可、複製してカスタム版を作成)
- ファイルテンプレート / エントリテンプレートの入力欄(テキストエリア)
- 利用可能なプレースホルダー一覧のヘルプ表示
- サンプルデータを使った即時プレビュー表示

新規ファイル: `src/dashboard/markdownTemplatePanel.ts` + 対応する HTML/CSS(既存の `src/dashboard/` 構成・命名パターンに準拠)。

## テスト方針

TDD で進める(Red-Green-Refactor)。

- `markdownTemplateUtils.test.ts`: レンダリング処理・CRUD 操作・バリデーションの単体テスト
- `saveLocalMarkdownStep.test.ts` 該当箇所: テンプレート差し替え後もデフォルトテンプレート使用時は既存出力と完全一致することを検証する回帰テスト
- `dashboard.test.ts` 該当箇所: `formatEntryToMarkdown()` / `downloadDateMarkdown()` の統合後の回帰テスト

## 影響範囲まとめ

| 変更内容 | ファイル |
|---|---|
| 新規: テンプレートユーティリティ | `src/utils/markdownTemplateUtils.ts`(新規) |
| 新規: StorageKeys 追加 | `src/utils/storage/types.ts` |
| 変更: 自動エクスポートの整形処理 | `src/background/pipeline/steps/saveLocalMarkdownStep.ts` |
| 変更: 手動エクスポートの整形処理 | `src/dashboard/dashboard.ts` |
| 新規: 管理 UI | `src/dashboard/markdownTemplatePanel.ts`(新規)、対応 HTML/CSS |
| 変更なし(対象外) | `src/background/pipeline/steps/formatMarkdownStep.ts`、`src/dashboard/obsidianFormatter.ts`、`src/utils/markdownFormatter.ts` |
