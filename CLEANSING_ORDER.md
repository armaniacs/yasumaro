# クレンジングの順番 / Cleansing Order

[日本語](#日本語) | [English](#english)

---

## 日本語

Obsidian Weave には、2つのクレンジング機能があります。それぞれの目的と実行順序を説明します。

### クレンジング機能の概要

| 機能 | 目的 | 実行タイミング |
|------|------|----------------|
| **Content Cleansing** | Obsidianに保存する前に不要な情報を削除 | コンテンツ抽出後、Obsidian保存前 |
| **AI Summary Cleansing** | AI要約前に不要な情報を削除 | AI要約前 |

### クレンジングの実行順序

```
0. ページ全体バイト数を記録 [pageBytes: document.body.outerHTML のバイト数]
   ↓
1. コンテンツ抽出（findMainContentCandidates() で article/main タグ等から候補要素を選択）
   ↓ [candidateBytes: 候補要素の outerHTML のバイト数]
2. クローン作成（どちらかのクレンジングが有効な場合のみ）
   ↓
3. Content Cleansing（有効な場合）— クローンに対して実行
   - Hard Strip: タグ/属性ベースの削除
   - Keyword Strip: ID/クラスキーワードベースの削除
   ↓ [originalBytes / cleansedBytes: テキストベースのバイト数]
4. AI Summary Cleansing（有効な場合）— 同じクローンに対して実行
   - 画像alt属性の削除
   - メタデータの削除
   - 広告の削除
   - ナビゲーションの削除
   - ソーシャルウィジェットの削除
   - 積極的クレンジング（有効な場合）
   ↓ [aiSummaryOriginalBytes / aiSummaryCleansedBytes: outerHTML ベースのバイト数]
5. AI要約（AIプロバイダ設定が有効な場合）
   ↓
6. Obsidianに保存
```

> **注意**: ステップ3と4は**同一クローン**に対して順次実行されます。Content Cleansingで削除された要素は、その後のAI Summary Cleansingには存在しません。「設定は独立して有効/無効を切り替えられる」が、「データは直列パイプラインで処理される」という意味での独立性です。

**バイト数の計測基準**:

| フィールド | 計測基準 | 説明 |
|---|---|---|
| `pageBytes` | outerHTML | `document.body.outerHTML` のバイト数（ページ全体） |
| `candidateBytes` | outerHTML | `findMainContentCandidates()` で選ばれた候補要素の `outerHTML` のバイト数 |
| `originalBytes` | テキスト | `extractTextFromElement()` で取得したテキストのバイト数（nav/header等の除外済み） |
| `cleansedBytes` | テキスト | Content Cleansing 後のテキストのバイト数 |
| `aiSummaryOriginalBytes` | outerHTML | AI Summary Cleansing 直前の `element.outerHTML` のバイト数 |
| `aiSummaryCleansedBytes` | outerHTML | AI Summary Cleansing 直後の `element.outerHTML` のバイト数 |

> `originalBytes`/`cleansedBytes` はテキストベース、`aiSummaryOriginalBytes`/`aiSummaryCleansedBytes` は outerHTML ベースと**計測基準が異なります**。これらを直接比較することはできません。

**記録履歴への表示**:
- バイト数の削減がない場合（前後が同値）は表示されません
- トークン数の変化がない場合も表示されません

### 各クレンジングの詳細

#### Content Cleansing（コンテンツクレンジング）

**目的**: Obsidianに保存するコンテンツから不要な情報を削除し、ノートの品質を向上させます。

**設定項目**:
- **Hard Strip**: 特定のHTMLタグや属性を削除
  - 削除対象タグ: `<script>`, `<style>`, `<noscript>`, `<iframe>`, `<svg>`, `<video>`, `<audio>`, `<canvas>`, `<map>`, `<object>`, `<embed>`, `<picture>`, `<source>`, `<track>`, `<colgroup>`, `<col>`
  - 削除対象属性: `onclick`, `onload`, `onerror`, `onmouseover`, `onmouseout`, `onfocus`, `onblur`, `onchange`, `onsubmit`, `onreset`, `onselect`, `onkeydown`, `onkeypress`, `onkeyup`, `data-*`, `aria-*`, `role`, `class`, `id`, `style`, `hidden`, `tabindex`, `accesskey`, `contenteditable`, `draggable`, `spellcheck`, `translate`, `lang`, `dir`, `title`, `alt`, `src`, `href`, `data-src`, `data-href`
  - ⚠️ `href`・`src` も削除対象のため、リンクや画像の参照が失われます。Content CleansingはAI要約用ではなくObsidian保存用の最終クリーニングとして設計されています。

- **Keyword Strip**: ID/クラス名に特定のキーワードを含む**要素全体**を削除
  - デフォルトキーワード（日本語サイト向け）: `balance`, `account`, `meisai`（明細）, `login`, `card-number`, `keiyaku`（契約）
  - 英語圏の例に相当するキーワード: `billing`, `contract`, `statement` など（カスタマイズ可能）

**統計情報**:
- クレンジング前バイト数（テキストベース）
- クレンジング後バイト数（テキストベース）
- 削除された要素数
- クレンジング理由（`hard`, `keyword`, `both`, `none`）

#### AI Summary Cleansing（AI要約クレンジング）

**目的**: AI要約に送信するコンテンツから不要な情報を削除し、要約の精度と効率を向上させます。

> **処理タイミング**: AI Summary Cleansing は Content Cleansing の**後**に同一クローンに対して実行されます。Content Cleansingで削除された要素は AI Summary Cleansing の対象にはなりません。

**設定項目**:
- **画像alt属性**: 画像の `alt` 属性を削除（属性値のみ削除、要素は残る）
- **メタデータ**: `meta`, `title`, `link[rel=icon/stylesheet/canonical]` を削除
- **広告**: 広告関連クラス/IDを持つ要素を削除
- **ナビゲーション**: `nav`, `footer`, ナビゲーション関連クラス/IDを持つ要素を削除
- **ソーシャルウィジェット**: コメント・ソーシャル関連クラス/IDを持つ要素を削除
- **ディープクレンジング（実験的・デフォルト無効）**: 以下を追加削除
  - タグ: `aside`, `figure`, `figcaption`, `form`, `dialog`, `iframe`, `video`, `audio`, `script`, `style`, `noscript`, `button`, `input`, `select`, `details`
  - ARIA role: `banner`, `complementary`, `contentinfo`, `search`, `toolbar`
  - クラス/IDパターン:
    - クッキー・同意バナー: `cookie`, `consent`, `gdpr`, `privacy-notice`
    - ポップアップ・モーダル: `popup`, `modal`, `overlay`, `dialog`, `lightbox`
    - 通知・トースト: `toast`, `notification`, `ribbon`, `alert`, `snackbar`
    - 関連記事・レコメンド: `related`, `recommend`, `ranking`, `popular`, `trending`, `pickup`
    - ページネーション: `pagination`, `pager`, `page-nav`
    - 目次: `toc`, `table-of-contents`
    - タグ・カテゴリ: `tag-list`, `category-list`, `label-list`
    - 著者情報: `author`, `byline`, `profile-card`
    - メルマガ・購読: `subscribe`, `newsletter`, `signup-form`
    - CTA・プロモーション: `cta`, `call-to-action`, `promo-box`
    - ウィジェット: `widget`, `sidebar-widget`
    - 固定・フローティング: `sticky`, `fixed-bar`, `floating`
    - SNS埋め込み: `embed`, `twitter-tweet`, `instagram-media`
    - 日本語サイト: `kanren`（関連）, `osusume`（おすすめ）, `rankinglist`, `newlist`
    - 法的・ポリシー: `copyright`, `terms`, `privacy-policy`, `license`, `disclaimer`, `legal`, `site-info`
    - ナビゲーション強化: `breadcrumb`, `topic-path`, `search-form`, `site-search`, `global-nav`, `utility-nav`, `menu-button`, `hamburger`
    - ソーシャル・コミュニティ: `reaction`, `clap`, `like-button`, `share-box`, `sns-follow`, `comment-list`, `thread`, `response`
    - 著者・メタ情報詳細: `author-profile`, `writer-bio`, `post-date`, `update-date`, `post-meta`, `entry-footer`, `article-tag`
    - マーケティング: `offer`, `campaign`, `lead-capture`, `download-link`, `banner-area`, `promotion`, `ad-slot`
    - 日本語BEM系: `l-footer`, `l-header`, `l-sidebar`, `p-entry__footer`, `p-entry__header`, `c-button`, `c-label`, `common-footer`, `sub-column`
  - リンク密度が70%超の `ul/ol` リスト（メニュー的なリストと判定）
  - 非表示要素: `[hidden]`, `[aria-hidden="true"]`, `[style*="display:none"]`, `[style*="display: none"]`
  - 空要素: テキストコンテンツが空の `div`, `span`, `p`

**統計情報**:
- クレンジング前バイト数（outerHTMLベース）
- クレンジング後バイト数（outerHTMLベース）
- 削除された要素数（各カテゴリ別）
- クレンジング理由（`alt`, `metadata`, `ads`, `nav`, `social`, `deep`, `multiple`, `none`）

### 設定の独立性とデータの依存性

| 観点 | 説明 |
|---|---|
| **設定** | 独立。どちらか一方のみ有効にすることが可能 |
| **データ** | 直列パイプライン。Content Cleaning の結果を引き継いで AI Summary Cleansing が実行される |
| **クローン** | 両方が有効な場合でも、クローンは1つだけ作成される |
| **元ページ** | クレンジングは元のWebページには影響しない |

### 設定場所

- **Content Cleansing**: Dashboard → Content Cleansing タブ
- **AI Summary Cleansing**: Dashboard → AI Summary Cleansing タブ

---

## English

Obsidian Weave has two cleansing features. Here's an explanation of their purpose and execution order.

### Overview of Cleansing Features

| Feature | Purpose | Execution Timing |
|---------|---------|-------------------|
| **Content Cleansing** | Remove unnecessary information before saving to Obsidian | After content extraction, before Obsidian save |
| **AI Summary Cleansing** | Remove unnecessary information before AI summarization | Before AI summarization |

### Cleansing Execution Order

```
0. Record full page byte count [pageBytes: byte count of document.body.outerHTML]
   ↓
1. Content Extraction (findMainContentCandidates() selects candidate element from article/main tags, etc.)
   ↓ [candidateBytes: byte count of candidate element's outerHTML]
2. Clone creation (only when at least one cleansing is enabled)
   ↓
3. Content Cleansing (if enabled) — applied to the clone
   - Hard Strip: Tag/attribute-based removal
   - Keyword Strip: ID/class keyword-based removal
   ↓ [originalBytes / cleansedBytes: text-based byte count]
4. AI Summary Cleansing (if enabled) — applied to the same clone
   - Remove image alt attributes
   - Remove metadata
   - Remove ads
   - Remove navigation
   - Remove social widgets
   - Aggressive cleansing (if enabled)
   ↓ [aiSummaryOriginalBytes / aiSummaryCleansedBytes: outerHTML-based byte count]
5. AI Summarization (if AI provider settings are enabled)
   ↓
6. Save to Obsidian
```

> **Note**: Steps 3 and 4 run sequentially on the **same clone**. Elements removed by Content Cleansing are no longer present when AI Summary Cleansing runs. "Independent" means settings can be toggled separately — not that they process different data.

**Byte Measurement Basis**:

| Field | Basis | Description |
|---|---|---|
| `pageBytes` | outerHTML | Byte count of `document.body.outerHTML` (entire page) |
| `candidateBytes` | outerHTML | Byte count of candidate element's `outerHTML` from `findMainContentCandidates()` |
| `originalBytes` | text | Byte count of text from `extractTextFromElement()` (nav/header already excluded) |
| `cleansedBytes` | text | Byte count of text after Content Cleansing |
| `aiSummaryOriginalBytes` | outerHTML | Byte count of `element.outerHTML` just before AI Summary Cleansing |
| `aiSummaryCleansedBytes` | outerHTML | Byte count of `element.outerHTML` just after AI Summary Cleansing |

> `originalBytes`/`cleansedBytes` use a **text-based** measurement, while `aiSummaryOriginalBytes`/`aiSummaryCleansedBytes` use an **outerHTML-based** measurement. These cannot be directly compared.

**Display in History**:
- Byte counts are hidden when there is no reduction (before = after)
- Token counts are hidden when there is no change

### Details of Each Cleansing

#### Content Cleansing

**Purpose**: Remove unnecessary information from content to be saved to Obsidian, improving note quality.

**Settings**:
- **Hard Strip**: Remove specific HTML tags and attributes
  - Removed tags: `<script>`, `<style>`, `<noscript>`, `<iframe>`, `<svg>`, `<video>`, `<audio>`, `<canvas>`, `<map>`, `<object>`, `<embed>`, `<picture>`, `<source>`, `<track>`, `<colgroup>`, `<col>`
  - Removed attributes: `onclick`, `onload`, `onerror`, `onmouseover`, `onmouseout`, `onfocus`, `onblur`, `onchange`, `onsubmit`, `onreset`, `onselect`, `onkeydown`, `onkeypress`, `onkeyup`, `data-*`, `aria-*`, `role`, `class`, `id`, `style`, `hidden`, `tabindex`, `accesskey`, `contenteditable`, `draggable`, `spellcheck`, `translate`, `lang`, `dir`, `title`, `alt`, `src`, `href`, `data-src`, `data-href`
  - ⚠️ `href` and `src` are included in removal targets, so links and image references will be lost. Content Cleansing is designed as a final cleanup for Obsidian storage, not for AI summarization.

- **Keyword Strip**: Remove **entire elements** whose ID/class names contain specific keywords
  - Default keywords (Japanese site-oriented): `balance`, `account`, `meisai` (statement), `login`, `card-number`, `keiyaku` (contract)
  - English equivalents: `billing`, `contract`, `statement`, etc. (customizable)

**Statistics**:
- Bytes before cleansing (text-based)
- Bytes after cleansing (text-based)
- Number of removed elements
- Cleansing reason (`hard`, `keyword`, `both`, `none`)

#### AI Summary Cleansing

**Purpose**: Remove unnecessary information from content to be sent to AI summarization, improving summary accuracy and efficiency.

> **Processing timing**: AI Summary Cleansing runs **after** Content Cleansing on the same clone. Elements already removed by Content Cleansing are not targets for AI Summary Cleansing.

**Settings**:
- **Image alt attributes**: Remove `alt` attribute values from images (attribute only; element remains)
- **Metadata**: Remove `meta`, `title`, `link[rel=icon/stylesheet/canonical]`
- **Ads**: Remove elements with ad-related class/ID patterns
- **Navigation**: Remove `nav`, `footer`, and elements with navigation-related class/ID patterns
- **Social widgets**: Remove elements with comment/social-related class/ID patterns
- **Deep Cleansing (Experimental — disabled by default)**: Additionally removes:
  - Tags: `aside`, `figure`, `figcaption`, `form`, `dialog`, `iframe`, `video`, `audio`, `script`, `style`, `noscript`, `button`, `input`, `select`, `details`
  - ARIA roles: `banner`, `complementary`, `contentinfo`, `search`, `toolbar`
  - Class/ID patterns:
    - Cookie/consent banners: `cookie`, `consent`, `gdpr`, `privacy-notice`
    - Popups/modals: `popup`, `modal`, `overlay`, `dialog`, `lightbox`
    - Notifications/toasts: `toast`, `notification`, `ribbon`, `alert`, `snackbar`
    - Related/recommended: `related`, `recommend`, `ranking`, `popular`, `trending`, `pickup`
    - Pagination: `pagination`, `pager`, `page-nav`
    - Table of contents: `toc`, `table-of-contents`
    - Tags/categories: `tag-list`, `category-list`, `label-list`
    - Author info: `author`, `byline`, `profile-card`
    - Newsletter/subscriptions: `subscribe`, `newsletter`, `signup-form`
    - CTA/promotions: `cta`, `call-to-action`, `promo-box`
    - Widgets: `widget`, `sidebar-widget`
    - Sticky/floating elements: `sticky`, `fixed-bar`, `floating`
    - Social embeds: `embed`, `twitter-tweet`, `instagram-media`
    - Japanese sites: `kanren` (related), `osusume` (recommended), `rankinglist`, `newlist`
    - Legal/policy: `copyright`, `terms`, `privacy-policy`, `license`, `disclaimer`, `legal`, `site-info`
    - Enhanced navigation: `breadcrumb`, `topic-path`, `search-form`, `site-search`, `global-nav`, `utility-nav`, `menu-button`, `hamburger`
    - Social/community: `reaction`, `clap`, `like-button`, `share-box`, `sns-follow`, `comment-list`, `thread`, `response`
    - Author/post metadata: `author-profile`, `writer-bio`, `post-date`, `update-date`, `post-meta`, `entry-footer`, `article-tag`
    - Marketing: `offer`, `campaign`, `lead-capture`, `download-link`, `banner-area`, `promotion`, `ad-slot`
    - Japanese BEM-style: `l-footer`, `l-header`, `l-sidebar`, `p-entry__footer`, `p-entry__header`, `c-button`, `c-label`, `common-footer`, `sub-column`
  - `ul/ol` lists with link density exceeding 70% (identified as navigation-style lists)
  - Hidden elements: `[hidden]`, `[aria-hidden="true"]`, `[style*="display:none"]`
  - Empty elements: `div`, `span`, `p` with no text content

**Statistics**:
- Bytes before cleansing (outerHTML-based)
- Bytes after cleansing (outerHTML-based)
- Number of removed elements (by category)
- Cleansing reason (`alt`, `metadata`, `ads`, `nav`, `social`, `deep`, `multiple`, `none`)

### Setting Independence vs. Data Dependency

| Aspect | Description |
|---|---|
| **Settings** | Independent — each can be enabled/disabled separately |
| **Data** | Sequential pipeline — AI Summary Cleansing receives the output of Content Cleansing |
| **Clone** | One clone created even when both are enabled |
| **Original page** | Cleansing never affects the original web page |

### Settings Location

- **Content Cleansing**: Dashboard → Content Cleansing tab
- **AI Summary Cleansing**: Dashboard → AI Summary Cleansing tab
