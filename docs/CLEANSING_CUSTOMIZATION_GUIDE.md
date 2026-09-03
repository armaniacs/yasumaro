# クレンジングのカスタマイズガイド / Cleansing Customization Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

AI 要約から重要な情報が誤って削除される（誤削除）場合に、原因を報告し、ドメイン単位でクレンジング設定を上書きできます。このガイドでは次の2つの機能を説明します。

1. **誤削除を報告** — popup からワンクリックで報告
2. **ドメイン別クレンジング上書き** — 特定ドメインだけ設定を変更

### 誤削除を報告

popup の「Cleansing」セクションにある **「誤削除を報告」** ボタンを押すと、次の情報がローカルの報告キューに記録されます。

- ページ URL とドメイン
- ページ HTML の先頭 500 文字
- 何の理由で何個の要素が削除されたかの統計

**この情報は端末内（`chrome.storage.local`）にのみ保存され、外部へ送信されることはありません。**

報告された内容は、ダッシュボードの **「AI 要約クレンジング」設定パネル →「Cleansing Feedback」** で一覧できます。個別に削除するか、「Clear All」で全件クリアします。報告は履歴管理の補助であり、開発元へ自動送信されるものではありません。

### ドメイン別クレンジング上書き（Per-Site Overrides）

同じドメインで繰り返し誤削除が発生する場合は、そのドメインだけクレンジング設定を上書きできます。

1. ダッシュボードの「AI 要約クレンジング」パネルを開く
2. ドメインを追加し、上書きしたいトグル（カテゴリ）を変更する
3. 保存すると、そのドメインにのみ上書き設定が適用される

**マッチングルール:**

- ドメインは**完全一致**（小文字化・前後空白除去後）でのみ判定されます。**サブドメインは別ドメインとして扱われます**（`example.com` の上書きは `www.example.com` には適用されません）
- 上書きはベース設定への差分マージです。未指定の項目はグローバル設定が使われます

### デフォルトキーワードについて

キーワード設定の「初期設定」「リセット」で表示される一覧は、実際のクレンジングで使う全キーワード（50語超、日本語・英語両方のパターン）と一致しています。内容の詳細は [クレンジングの順番](CLEANSING_ORDER.md) をご覧ください。

---

## English

### Overview

When important information is accidentally removed by the AI summary cleansing (a "false positive"), you can report it and override cleansing settings per domain. This guide covers two features:

1. **Report Cleansing Feedback** — one-click reporting from the popup
2. **Per-site cleansing overrides** — change settings for specific domains only

### Report Cleansing Feedback

Press the **"Report Cleansing Feedback"** button in the popup's "Cleansing" section to record the following into a local feedback queue:

- Page URL and domain
- The first 500 characters of the page HTML
- Statistics of how many elements were removed and why

**This information is stored only on your device (`chrome.storage.local`) and is never sent anywhere.**

Reported entries are listed in the dashboard under **AI Summary Cleansing settings → "Cleansing Feedback"**. You can delete entries individually or clear all of them with "Clear All". The feedback queue is an aid for your own history management — it is not sent to the developers.

### Per-Site Cleansing Overrides

If mis-deletions keep happening on the same domain, you can override cleansing settings for that domain only:

1. Open the **AI Summary Cleansing** panel in the dashboard
2. Add the domain and change the toggles (categories) you want to override
3. On save, the override applies only to that domain

**Matching rules:**

- Domains match by **exact match only** (after lowercasing and trimming). **Subdomains are treated as different domains** — an override for `example.com` does not apply to `www.example.com`
- Overrides are a differential merge over the base config: unspecified items fall back to the global settings

### About the Default Keywords

The list shown by "Defaults" and "Reset" in the keyword settings matches the full keyword list used by the actual cleansing logic (50+ words). See [Cleansing Order](CLEANSING_ORDER.md) for details.
