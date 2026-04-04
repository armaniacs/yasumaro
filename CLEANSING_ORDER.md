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
   - 固定要素削除（有効な場合）— position:fixed/sticky の追従バナー
   - 推荐セクション削除（有効な場合）— おすすめ・関連記事等
   - ページネーション削除（有効な場合）— 次へ/前へのボタン等
   - SNS/プロモ削除（有効な場合）— スポンサー製品・トレンド等
   - ポップアップ削除（有効な場合）— モーダル・トースト通知
   - プラットフォーム噪声削除（有効な場合）— YouTubeコメント欄・5ch ID等
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
- **JSON-LD**: 構造化データ（`application/ld+json`）を削除
- **遅延読み込み**: `loading="lazy"` 属性や `data-src` を持つ要素を削除
- **スキップリンク**: スキップリンク（`[href="#main"]` 等）を削除
- **カード要素**: 記事カード・リストアイテム（`card`, `list-item` 等）を削除
- **リンク密度**: リンク密度70%超のブロックを削除
- **高度クレンジングオプション**:
  - **固定要素削除**（デフォルト: 無効）: position:fixed/sticky の追従バナーを削除（Yahoo! News、Game8等）
  - **推荐セクション削除**（デフォルト: **有効**）: おすすめ・関連知見・ランキング等を削除（Amazon、Yahoo!、Game8等）
  - **ページネーション削除**（デフォルト: 無効）: 次へ/前へ・ページ番号を削除
  - **SNS/プロモ削除**（デフォルト: 無効）: スポンサー製品・トレンド等を削除
  - **ポップアップ削除**（デフォルト: **有効**）: モーダル・トースト通知・cookie同意バーを削除
  - **プラットフォーム噪声削除**（デフォルト: 無効）: YouTubeコメント欄・5ch/be ID等を削除

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
   - Fixed element removal (if enabled) — sticky/fixed header banners
   - Recommendation section removal (if enabled) — related articles, rankings
   - Pagination removal (if enabled) — next/prev buttons, page numbers
   - SNS/Promo removal (if enabled) — sponsored products, trends
   - Popup removal (if enabled) — modals, toast notifications
   - Platform noise removal (if enabled) — YouTube comments, 5ch IDs
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
- **JSON-LD**: Remove structured data (`application/ld+json`)
- **Lazy load**: Remove elements with `loading="lazy"` or `data-src`
- **Skip links**: Remove skip links (`[href="#main"]` etc.)
- **Card elements**: Remove article cards/list items (`card`, `list-item`, etc.)
- **Link density**: Remove blocks with link density over 70%
- **Advanced Cleansing Options**:
  - **Fixed elements** (default: disabled): Remove position:fixed/sticky sticky banners (Yahoo! News, Game8)
  - **Recommendation sections** (default: **enabled**): Remove recommended articles, rankings (Amazon, Yahoo!, Game8)
  - **Pagination** (default: disabled): Remove next/prev, page numbers
  - **SNS/Promo** (default: disabled): Remove sponsored products, trends
  - **Popups** (default: **enabled**): Remove modals, toast notifications, cookie consent bars
  - **Platform noise** (default: disabled): Remove YouTube comments, 5ch/be IDs

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
