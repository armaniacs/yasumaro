# ローカル Markdown 書き出し / Local Markdown Export

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

Yasumaro は、Obsidian に接続せずに閲覧履歴を Markdown ファイルとしてブラウザのダウンロードフォルダに保存する機能を備えています。REST API のセットアップが不要なため、導入のハードルが低いです。

### 書き出しタイミング（4モード）

「ローカル Markdown に書き出す」を ON にすると、以下の4つのタイミングから選べます（デフォルトは「アイドル時 / 30分ごと」）。

| モード | 説明 |
|-------|------|
| **手動のみ** | 自動書き出しはせず、手動エクスポート実行時のみ Markdown 化します |
| **即時** | ページが記録されるたびに、当日分のバッファ（`local_export_YYYY-MM-DD`）に追記し、約1分後に発火するワンショットアラームでバッファをダウンロードします。連続記録時はアラームが差し替えられるため、ダウンロードは最短1分間隔に間引かれます |
| **アイドル時 / 30分ごと** | ブラウザがアイドル状態になったとき、または最大30分ごとにまとめて書き出します |
| **日付が変わったとき** | 日付が変わったタイミングで前日分をまとめて回収します |

これとは別に、開始日・終了日を指定して SQLite に保存された既存の履歴を Markdown に変換する「手動エクスポート」がいつでも利用できます。

### 設定方法

1. ダッシュボードの「初期設定」を開く
2. 「ローカル Markdown 書き出し」セクションを探す
3. 「ローカル Markdown に書き出す」チェックボックスを ON にする
4. 書き出しタイミングを4つから選ぶ
5. 「保存する」ボタンをクリック

### 書き出しフォルダ

デフォルトではブラウザのダウンロードフォルダ直下の `Yasumaro/` サブフォルダに保存されます（`chrome.downloads` のファイル名として `{サブフォルダ名}/{日付}.md` の形式で書き出されます）。変更できるのはサブフォルダ名のみであり、ダウンロードフォルダ自体はブラウザの設定に従います。

### ファイル形式

日付ごとに `YYYY-MM-DD.md` ファイルが生成されます。デフォルトのテンプレートでは各ファイルの内容は以下の形式です（`{{tags}}` を含みます）:

```markdown
# 2026-07-05

- 14:30 [ページタイトル](https://example.com)
    - #タグ AI が生成した要約テキスト
- 15:00 [別のページ](https://example.com/page2)
    - 2番目のページの要約
```

書き出しテンプレートはユーザーがカスタマイズできます（利用可能なプレースホルダー: `timestamp`・`title`・`url`・`summary`・`tags`・`domain`、ファイル側: `date`・`entryCount`）。

なお、上記は自動書き出し（テンプレート方式）の形式です。「ログをエクスポート」パネルからの手動 Markdown エクスポートは異なる形式（YAMLフロントマター付き）で出力されます。

### 書き出しの発火条件（即時・アイドル時・日付変更時）

「手動のみ」以外のモードでの自動書き出しは、以下の条件をすべて満たした場合にのみ発火します:

1. 「ローカル Markdown に書き出す」が ON
2. ページが記録条件（最小滞在時間・最小スクロール深度）を満たす
3. ページがドメインフィルターやプライバシー検出を通過する

**注意**: ページを閲覧しただけで自動記録されるわけではありません。記録条件を満たした場合のみです。

### 手動エクスポート

既存の履歴を Markdown に変換するには:

1. ダッシュボードの「初期設定」→「ローカル Markdown 書き出し」セクションで、開始日と終了日を指定
2. 「エクスポート」ボタンをクリック

または:

1. ダッシュボードの「ログをエクスポート」セクションで、日付範囲を指定してエクスポート

> 日次バッファには1日あたり最大2,000件の上限があります。上限を超えた場合、古いエントリから順に破棄されます。

### ダウンロード通知の非表示化

自動書き出しのたびにブラウザのダウンロード通知が表示される場合、以下の設定で非表示にできます:

**Chrome の場合:**
1. `chrome://settings/downloads` を開く
2. 「ダウンロードが完了したとき、ダウンロード一覧を表示する」のトグルを OFF

**Edge の場合:**
1. `edge://settings/downloads` を開く
2. 「ダウンロードが完了したときにダウンロード メニューを表示する」のトグルを OFF

### Obsidian との違い

| 項目 | ローカル Markdown | Obsidian 連携 |
|------|------------------|--------------|
| セットアップ |不要（ON/OFF のみ）| REST API プラグインが必要 |
| 保存先 | ブラウザのダウンロードフォルダ | Obsidian Vault |
| 動作 | ダウンロード（都度ファイル生成） | API 経由の追記 |
| 同時使用 | 可能 | 可能 |

### トラブルシューティング

**Q. ファイルがダウンロードされない**
- ダッシュボードで「ローカル Markdown に書き出す」が ON になっているか確認
- 書き出しタイミングが「手動のみ」になっていないか確認（この場合は手動エクスポートを実行する必要があります）
- 記録条件（滞在時間・スクロール深度）を満たしているか確認
- Service Worker コンソールで `[LocalMD]` でログを確認

**Q. 同じファイルが複数回ダウンロードされる**
- フラッシュのたびに完全な日次ファイルが再ダウンロード（上書き）される仕組みになっています
- 気になる場合は「アイドル時 / 30分ごと」または「日付が変わったとき」に変更すると、まとめて1回の書き出しになります
- Chrome のダウンロード設定で「同じファイルがある場合の動作」を「上書き」に設定してください

**Q. 日付が1日ずれる**
- バージョン 6.5.1 以降では修正済みです。最新版に更新してください

---

## English

### Overview

Yasumaro can save your browsing history as Markdown files to your browser's download folder without connecting to Obsidian. This lowers the barrier to entry since no REST API setup is required.

### Export Timing (4 Modes)

Once "Export to Local Markdown" is ON, choose one of four timing modes (default is "Idle / every 30 min"):

| Mode | Description |
|------|-------------|
| **Manual only** | No automatic export; Markdown is generated only when you run a manual export |
| **Immediate** | Each time a page is recorded, its entry is appended to that day's buffer (`local_export_YYYY-MM-DD`) in chrome.storage, and a one-shot alarm fires in about a minute to download the buffer. Rapid recordings replace the pending alarm, so downloads are debounced to at most once per minute |
| **Idle / every 30 min** | Batches the export when the browser becomes idle, or at least every 30 minutes |
| **On date change** | Collects the previous day's records into one file when the date rolls over |

Independently of these modes, you can always run a manual export by specifying a start and end date to convert existing history from SQLite to Markdown.

### Setup

1. Open "Initial Setup" in the dashboard
2. Find the "Local Markdown Export" section
3. Toggle "Export to Local Markdown" ON
4. Choose an export timing mode
5. Click "Save"

### Export Folder

Files are saved to a `Yasumaro/` subfolder inside the browser's download folder by default (exported via `chrome.downloads` as `{subfolder}/{date}.md`). Only the subfolder name is configurable; the download folder itself follows the browser's settings.

### File Format

A `YYYY-MM-DD.md` file is generated for each date. With the default template the content looks like this (note `{{tags}}`):

```markdown
# 2026-07-05

- 14:30 [Page Title](https://example.com)
    - #tags AI-generated summary text
- 15:00 [Another Page](https://example.com/page2)
    - Summary of the second page
```

Export templates are user-customizable (entry placeholders: `timestamp`, `title`, `url`, `summary`, `tags`, `domain`; file placeholders: `date`, `entryCount`).

Note that the above is the auto-export (template-based) format. Manual Markdown export from the Export Logs panel uses a different format with YAML frontmatter.

### Export Trigger Conditions (Immediate / Idle / Date Change)

For any mode other than "Manual only", automatic export only fires when ALL of the following are met:

1. "Export to Local Markdown" is ON
2. The page meets recording conditions (minimum visit duration and scroll depth)
3. The page passes domain filters and privacy detection

**Note**: Simply visiting a page does not trigger recording. The recording conditions must be met.

### Manual Export

To convert existing history to Markdown:

1. In "Initial Setup" → "Local Markdown Export", specify start and end dates, then click "Export"

Or:

1. In "Export Logs", specify a date range and export

> The daily buffer is capped at 2,000 entries per day. When the cap is exceeded, the oldest entries are dropped first.

### Hiding Download Notifications

If the browser's download notification appears each time a file is exported, you can hide it:

**Chrome:**
1. Open `chrome://settings/downloads`
2. Toggle off "Show downloads when they're done"

**Edge:**
1. Open `edge://settings/downloads`
2. Toggle off "Show downloads when they're done after each download"

### Differences from Obsidian

| Feature | Local Markdown | Obsidian |
|---------|---------------|----------|
| Setup | None (just toggle ON/OFF) | Requires REST API plugin |
| Save Location | Browser download folder | Obsidian Vault |
| Mechanism | Download (file regenerated each time) | API append |
| Simultaneous Use | Supported | Supported |

### Troubleshooting

**Q. Files are not being downloaded**
- Verify "Export to Local Markdown" is ON in the dashboard
- Check whether the export timing is set to "Manual only" (in that case you need to run a manual export)
- Confirm recording conditions (visit duration and scroll depth) are being met
- Check Service Worker console logs for `[LocalMD]`

**Q. The same file is downloaded multiple times**
- Each flush re-downloads (overwrites) the complete daily file — this is how the feature is designed to work
- Switch to "Idle / every 30 min" or "On date change" if you'd rather have a single batched export
- Set Chrome's download setting for "When a file with the same name exists" to "Overwrite"

**Q. The date is off by one day**
- Fixed in version 6.5.1 and later. Update to the latest version.
