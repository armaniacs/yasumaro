# クレンジングの順番 / Cleansing Order

[日本語](#日本語) | [English](#english)

---

## 日本語

Yasumaro には、2つのクレンジング機能があります。それぞれの目的と実行順序を説明します。

### クレンジング機能の概要

| 機能 | 目的 | 実行タイミング |
|------|------|----------------|
| **Content Cleansing** | Obsidianに保存する前に不要な情報を削除 | コンテンツ抽出後、Obsidian保存前 |
| **AI Summary Cleansing** | AI要約前に不要な情報を削除 | AI要約前 |

### クレンジングの実行順序

```
1. コンテンツ抽出（ページ本文の主要部分を選択）
   ↓
2. Content Cleansing（有効な場合）
   - Hard Strip: 不要なタグ・属性を削除
   - Keyword Strip: ID/クラス名に特定キーワードを含む要素を削除
   ↓
3. AI Summary Cleansing（有効な場合）— Content Cleansing 後のデータに対して実行
   - 画像alt属性・メタデータ・広告・ナビゲーション・ソーシャルウィジェットを削除
   - 固定バナー・おすすめセクション・ページネーション・ポップアップ等（各オプションによる）
   ↓
4. AI要約（AIプロバイダー設定が有効な場合）
   ↓
5. Obsidianに保存
```

> **注意**: Content Cleansing と AI Summary Cleansing は同一のデータに対して順次実行されます。Content Cleansing で削除された要素は AI Summary Cleansing の対象にはなりません。どちらか一方のみを有効にすることも可能です。

**記録履歴への表示**: バイト数やトークン数の変化がない場合、統計情報は表示されません。

### 各クレンジングの詳細

#### Content Cleansing（コンテンツクレンジング）

**目的**: Obsidianに保存するコンテンツから不要な情報を削除し、ノートの品質を向上させます。

**設定項目**:
- **Hard Strip**: 特定のHTMLタグや属性を削除
  - 削除対象タグ: `<script>`, `<style>`, `<iframe>`, `<canvas>`, `<embed>`, `<object>`, `<audio>`, `<video>`, `<input>`, `<textarea>`, `<select>`, `<button>`, `<form>`
  - 削除対象属性: `type="password"`, `type="hidden"`, `type="file"`, `type="email"`, `type="tel"`, `autocomplete`（属性自体）, `inputmode="numeric|tel|email"`
  - 属性の削除は要素が削除されるわけではなく、特定のセキュリティ上重要な属性パターンを持つ要素を削除します。`onclick` などのイベントハンドラや `class`/`id`/`href`/`src` は**削除されません**。

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
  - **おすすめセクション削除**（デフォルト: **有効**）: おすすめ・関連記事・ランキング等を削除（Amazon、Yahoo!、Game8等）
  - **ページネーション削除**（デフォルト: 無効）: 次へ/前へ・ページ番号を削除
  - **SNS/プロモ削除**（デフォルト: 無効）: スポンサー製品・トレンド等を削除
  - **ポップアップ削除**（デフォルト: **有効**）: モーダル・トースト通知・cookie同意バーを削除
  - **プラットフォームノイズ削除**（デフォルト: 無効）: YouTubeコメント欄・5ch/be ID等を削除

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

Yasumaro has two cleansing features. Here's an explanation of their purpose and execution order.

### Overview of Cleansing Features

| Feature | Purpose | Execution Timing |
|---------|---------|-------------------|
| **Content Cleansing** | Remove unnecessary information before saving to Obsidian | After content extraction, before Obsidian save |
| **AI Summary Cleansing** | Remove unnecessary information before AI summarization | Before AI summarization |

### Cleansing Execution Order

```
1. Content Extraction (selects the main body of the page)
   ↓
2. Content Cleansing (if enabled)
   - Hard Strip: Remove unnecessary tags and attributes
   - Keyword Strip: Remove elements whose ID/class names contain specific keywords
   ↓
3. AI Summary Cleansing (if enabled) — applied to the output of Content Cleansing
   - Remove image alt attributes, metadata, ads, navigation, social widgets
   - Fixed banners, recommendation sections, pagination, popups, etc. (per individual options)
   ↓
4. AI Summarization (if AI provider is configured)
   ↓
5. Save to Obsidian
```

> **Note**: Content Cleansing and AI Summary Cleansing run sequentially on the same data. Elements removed by Content Cleansing are not targets for AI Summary Cleansing. Either feature can be enabled independently of the other.

**Display in History**: Statistics (byte counts, token counts) are hidden when no reduction occurred.

### Details of Each Cleansing

#### Content Cleansing

**Purpose**: Remove unnecessary information from content to be saved to Obsidian, improving note quality.

**Settings**:
- **Hard Strip**: Remove specific HTML tags and attributes
  - Removed tags: `<script>`, `<style>`, `<iframe>`, `<canvas>`, `<embed>`, `<object>`, `<audio>`, `<video>`, `<input>`, `<textarea>`, `<select>`, `<button>`, `<form>`
  - Attribute-based removals: `type="password"`, `type="hidden"`, `type="file"`, `type="email"`, `type="tel"`, `autocomplete` attribute, `inputmode="numeric|tel|email"`
  - Attribute-based removal deletes the entire element, not just the attribute. Event handler attributes (`onclick`, etc.) and styling attributes (`class`, `id`, `href`, `src`) are **not** removed.

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
