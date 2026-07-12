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
| **即時** | ページが記録されるたびに、その日の Markdown ファイルを自動ダウンロードします（最短1分間隔） |
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

デフォルトでは `~/Downloads/Yasumaro/` に保存されます。フォルダ名はダッシュボードで変更できます。

### ファイル形式

日付ごとに `YYYY-MM-DD.md` ファイルが生成されます。各ファイルの内容は以下の形式です:

```markdown
# 2026-07-05

- 14:30 [ページタイトル](https://example.com)
    - AI が生成した要約テキスト
- 15:00 [別のページ](https://example.com/page2)
    - 2番目のページの要約
```

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

1. ダッシュボードの「ログをエキスポート」セクションで、日付範囲を指定してエクスポート

または:

1. ダッシュボードの「履歴」セクションで、「すべて Markdown に書き出す」ボタンをクリック（全期間が対象）

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
- 「即時」モードでは、記録のたびに完全な日次ファイルが再ダウンロードされる仕組みになっています
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
| **Immediate** | Each time a page is recorded, that day's Markdown file is automatically downloaded (at most once per minute) |
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

Files are saved to `~/Downloads/Yasumaro/` by default. The folder name can be changed in the dashboard.

### File Format

A `YYYY-MM-DD.md` file is generated for each date:

```markdown
# 2026-07-05

- 14:30 [Page Title](https://example.com)
    - AI-generated summary text
- 15:00 [Another Page](https://example.com/page2)
    - Summary of the second page
```

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

Or:

1. In "History", click "Export All as Markdown" (exports all records)

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
- In "Immediate" mode, each recording re-downloads the complete daily file — this is how the feature is designed to work
- Switch to "Idle / every 30 min" or "On date change" if you'd rather have a single batched export
- Set Chrome's download setting for "When a file with the same name exists" to "Overwrite"

**Q. The date is off by one day**
- Fixed in version 6.5.1 and later. Update to the latest version.
