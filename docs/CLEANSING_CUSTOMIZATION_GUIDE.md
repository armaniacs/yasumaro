# クレンジングのカスタマイズガイド / Cleansing Customization Guide

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

AI 要約から重要な情報が誤って削除される（誤削除）場合に、原因を報告し、ドメイン単位でクレンジング設定を上書きできます。このガイドでは次の機能を説明します。

1. **クレンジングプリセット** — 32 個のトグルを4つのプリセットに集約
2. **誤削除を報告** — popup からワンクリックで報告
3. **ドメイン別クレンジング上書き** — 特定ドメインだけ設定を変更
4. **動的コンテンツと観測性** — SPA / Shadow DOM への対応と、除去内容の可視化

### クレンジングプリセット

`Dashboard → AI Summary Cleansing` のプリセット選択欄で、32 個のトグルをまとめて切り替えられます。

| プリセット | ON 数 | 内容 |
|---|---|---|
| `minimal` | 3 | alt テキスト、広告、ナビゲーションのみ |
| `balanced` | 9 | minimal に加え、メタデータ、SNS、推奨記事、ポップアップ、Cookie 同意バナー、ニュースメディア定型句（デフォルト） |
| `aggressive` | 25 | ほぼ全ルール ON。JSON-LD 除去や遅延読み込み属性など一部のみ OFF |
| `custom` | — | 個別調整。トグルを1つでも手で変更すると自動でこの表示になる |

保存形式は 32 キーそのままです。プリセットは 32 値を一括で埋めるショートカットとして機能します。まず `balanced` で使い、要約に不要な要素が残るなら `aggressive`、本文が削られるなら `minimal` へ、という調整で足ります。個別の要素だけ変えたい場合はトグルを直接操作するか、後述のドメイン別上書きを使います。

### 誤削除を報告

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

### 動的コンテンツと観測性

- **Cookie 同意バナーの除去** — OneTrust 系（`onetrust` / `ot-sdk` / `optanon` など）のバナー定型文を除去します。`cookie` ルールとして `balanced` 以上で有効です。判定はクラス名ではなくテキストで行い、誤爆を避けます
- **SPA と Shadow DOM** — `MutationObserver` で描画後のコンテンツ変化を検知し、`shadowRoot` や iframe の中も再帰的に走査します
- **多言語パターン** — 日本語・英語に加え、フランス語・ドイツ語・中国語の広告／SNS 定型句に対応します
- **除去内容の可視化** — ダッシュボードの「AI 要約クレンジング」パネルで、どのルールが何個の要素を除去したかの内訳と、クレンジング前後のテキスト差分を確認できます

ルールの適用順の詳細は [クレンジングの順番](CLEANSING_ORDER.md) をご覧ください。

### デフォルトキーワードについて

キーワード設定の「初期設定」「リセット」で表示される一覧は、実際のクレンジングで使う全キーワード（50語超、日本語・英語両方のパターン）と一致しています。内容の詳細は [クレンジングの順番](CLEANSING_ORDER.md) をご覧ください。

---

## English

### Overview

When important information is accidentally removed by the AI summary cleansing (a "false positive"), you can report it and override cleansing settings per domain. This guide covers:

1. **Cleansing presets** — 32 toggles collapsed into four presets
2. **Report Cleansing Feedback** — one-click reporting from the popup
3. **Per-site cleansing overrides** — change settings for specific domains only
4. **Dynamic content and observability** — SPA / Shadow DOM handling and visibility into what was removed

### Cleansing Presets

The preset selector in `Dashboard → AI Summary Cleansing` switches all 32 toggles at once.

| Preset | Rules ON | Contents |
|---|---|---|
| `minimal` | 3 | alt text, ads, navigation only |
| `balanced` | 9 | minimal plus metadata, social, recommended articles, popups, cookie consent banners, news-media boilerplate (default) |
| `aggressive` | 25 | nearly all rules on; a few (JSON-LD removal, lazy-load attributes, etc.) stay off |
| `custom` | — | individual adjustment; changing any toggle by hand switches to this automatically |

The stored format is still the 32 keys; a preset is a shortcut that fills all 32 values at once. Start with `balanced`, move to `aggressive` if unwanted elements remain in the summary, or to `minimal` if body text is being trimmed. To change only specific elements, edit the toggles directly or use per-site overrides below.

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

### Dynamic Content and Observability

- **Cookie consent banner removal** — removes boilerplate from OneTrust-style banners (`onetrust` / `ot-sdk` / `optanon`, etc.). Enabled as the `cookie` rule at `balanced` and above. Detection is by text, not class name, to avoid false matches
- **SPA and Shadow DOM** — a `MutationObserver` detects post-render content changes, and the traversal recurses into `shadowRoot` and iframes
- **Multilingual patterns** — in addition to Japanese and English, covers French, German, and Chinese ad / social boilerplate
- **Visibility into what was removed** — the AI Summary Cleansing panel shows a breakdown of which rule removed how many elements, and a text diff of before and after cleansing

See [Cleansing Order](CLEANSING_ORDER.md) for the rule application order.

### About the Default Keywords

The list shown by "Defaults" and "Reset" in the keyword settings matches the full keyword list used by the actual cleansing logic (50+ words). See [Cleansing Order](CLEANSING_ORDER.md) for details.
