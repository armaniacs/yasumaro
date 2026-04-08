# aiSummaryCleansingDeep 高性能化デザイン

**日付:** 2026-04-08  
**ステータス:** 承認済み  
**パターン:** B（独立オプション、各ルールを個別のトグル）

---

## 概要

`aiSummaryCleansingDeep` を高性能化し、数値ベースの新しいクレンジングルール12個を追加する。各ルールは独立した設定トグルとして用户提供し、細やかな制御を可能にする。

---

## 新しいストレージキー

| キー | 既定値 | 説明 |
|------|--------|------|
| `ai_summary_cleansing_text_density` | false | テキスト密度フィルタリング |
| `ai_summary_cleansing_short_seq` | false | 短文要素の連続削除 |
| `ai_summary_cleansing_symbol_line` | false | 特殊記号行の削除 |
| `ai_summary_cleansing_link_para` | false | リンクのみ段落の削除 |
| `ai_summary_cleansing_enhanced_hidden` | true | 非表示要素強化削除 |
| `ai_summary_cleansing_empty_elem` | true | 空要素の削除 |
| `ai_summary_cleansing_jp_layout` | false | JP BEM系レイアウトパターン |
| `ai_summary_cleansing_jp_navigation` | false | JP ナビ・剰利用語 |
| `ai_summary_cleansing_author` | false | 執筆者・メタ情報 |
| `ai_summary_cleansing_social` | false | ソーシャル・コミュニティ |
| `ai_summary_cleansing_link_density` | true | (既存: 強化) |

---

## 新しい関数（src/utils/aiSummaryCleaner.ts）

### 1. stripTextDensityElements()
- **機能:** 要素内の「文字数」に対する「リンクの文字数」の割合が70%以上の要素を削除
- **対象:** `ul`, `ol`, `div`, `nav`
- **閾値:** `LINK_TEXT_RATIO_THRESHOLD = 0.7`

### 2. stripShortSequenceElements()
- **機能:** 30文字以下の要素が連続して5つ以上並んでいる場合を削除
- **対象:** `p`, `span`, `li`, `div`
- **閾値:** `MAX_SHORT_TEXT_LENGTH = 30`, `MIN_SEQUENCE_COUNT = 5`

### 3. stripSymbolLineElements()
- **機能:** `|`, `»`, `◀`, `▶`, `>>`, `<<` を含む行を削除
- **対象:** `p`, `span`, `div`, `li`
- **パターン:** `/^[|\»◀▶»»«]+/` または要素テキスト内含有

### 4. stripLinkOnlyParagraphs()
- **機能:** 1つの`p`タグの中に`a`タグしか存在しない（かつ50文字以下）場合を削除
- **閾値:** `MAX_LINK_PARAGRAPH_LENGTH = 50`

### 5. stripEnhancedHiddenElements()
- **機能:** 既存のhidden削除を強化し以下を追加:
  - `[style*="visibility: hidden"]`
  - `[style*="visibility:hidden"]`
  - `[style*="opacity: 0"]` (位置固定要素)
  - `template` タグ
  - `slot` タグ
- **既定:** true

### 6. stripEmptyElements()
- **機能:** テキストを含まない `div`, `span`, `p`, `section`, `article` を削除
- **子要素も空の場合のみ対象**
- **既定:** true

### 7. stripJPLayoutPatterns()
- **機能:** 日本のコーダーがよく使うBEM系レイアウトパターンを削除
- **クラス/IDパターン:**
  - `l-footer`, `l-header`, `l-sidebar`, `l-wrapper`
  - `p-entry__footer`, `p-entry__header`, `p-entry__body`
  - `c-button`, `c-label`, `c-card`
  - `common-footer`, `common-header`, `sub-column`
  - `ly-`, `el-` (FLOCSS系)

### 8. stripJPNavigationPatterns()
- **機能:** 日本のウェブサイト特有のナビ・剰利用語パターンを削除
- **クラス/IDパターン:**
  - `global-nav`, `gnav`, `g-nav`, `primary-nav`
  - `footer-nav`, `fnav`
  - `topic-path`, `topicpath`, `breadcrumb`
  - `site-search`, `search-form`, `ss-search`
  - `utility-nav`, `sub-nav`, `local-nav`
- **キーワード:**
  - ` Site Menu`, `このサイトのメニュー`, `ページメニュー`

### 9. stripAuthorMetaElements()
- **機能:** 執筆者・メタ情報を削除
- **クラス/IDパターン:**
  - `author-profile`, `writer-bio`, `profile-card`
  - `post-date`, `update-date`, `post-meta`, `entry-meta`
  - `article-tag`, `post-tag`, `tag-list`
  - `entry-footer`, `article-footer`
- **キーワード:**
  - `この記事書いた人`, `プロフィール`, `投稿`, `更新日`, `著者`

### 10. stripSocialCommunityElements()
- **機能:** ソーシャル・コミュニティ要素を削除
- **クラス/IDパターン:**
  - `reaction`, `clap`, `like-button`, `like-button`
  - `share-box`, `sns-share`, `share-buttons`
  - `sns-follow`, `follow-button`, `follow-box`
  - `comment-list`, `comments`, `thread`, `response`
  - `social-buttons`, `social-links`
- **キーワード:**
  - `この記事をシェア`, `フォローする`, `コメントを書く`

---

## ダッシュボードUI（src/dashboard/dashboard.html）

「ディープクレンジング」セクション的家庭区切りを追加:

```html
<!-- Aggressive モード（数値ベース） -->
<fieldset class="cleansing-group">
  <legend data-i18n="aggressiveModeTitle">Aggressive モード（数値ベース）</legend>
  <!-- 各トグルスイッチ -->
</fieldset>

<!-- 日本ウェブサイト特有 -->
<fieldset class="cleansing-group">
  <legend data-i18n="jpSpecificTitle">日本ウェブサイト特有</legend>
  <!-- 各トグルスイッチ -->
</fieldset>
```

---

## 設定の распро-strategy

### extractor.ts 変更点
- `loadSettings()` に12個の新しいキーを追加
- 各キーに対応する変数を追加（例: `aiSummaryCleansingTextDensity`）
- `extractPageContent()` の `aiSummaryCleanseOptions` オブジェクトに12個の新しいプロパティを追加

### aiSummaryCleaner.ts 変更点
- `AiSummaryCleanseOptions` インターフェースに12個の新しいプロパティを追加
- `cleanseAiSummary()` 関数に12個の新しいロジックブロックを追加
- 戻り値の `AiSummaryCleanseResult` に12個の新しい `*Removed` プロパティを追加
- `countAISummaryTargets()` に対応カウントロジックを追加

---

## データフロー

```
extractor.ts (loadSettings)
    ↓ 12個の新しい設定を読み込み
    ↓ aiSummaryCleanseOptions に設定
extractMainContent()
    ↓ aiSummaryCleanseOptions を渡す
aiSummaryCleaner.ts (cleanseAiSummary)
    ↓ 各 strip*() 関数を条件分岐で呼び出し
    ↓ 削除カウントを累積
    ↓ ログ出力と戻り値
```

---

## テスト戦略

### ユニットテスト（src/utils/__tests__/aiSummaryCleaner.test.ts）
- 各新規関数に対して最低3件のテストケース
- 正常系: 削除対象が存在し正しく削除される
- 異常系: 削除対象が存在しない場合は0を返す
- エッジケース: 空要素、特殊文字のみ

### 例
```typescript
describe('stripTextDensityElements', () => {
  it('should remove elements with link text ratio > 70%', () => {...});
  it('should keep elements with normal link text ratio', () => {...});
  it('should return 0 when no target elements exist', () => {...});
});

describe('stripShortSequenceElements', () => {
  it('should remove 5+ consecutive short elements', () => {...});
  it('should keep isolated short elements', () => {...});
  it('should return 0 when sequence count < 5', () => {...});
});
```

---

## i18n 対応

追加する翻訳キー（_locales/ja/messages.json, _locales/en/messages.json）:
- `aggressiveModeTitle`
- `aiSummaryCleansingTextDensity` / `Desc`
- `aiSummaryCleansingShortSeq` / `Desc`
- `aiSummaryCleansingSymbolLine` / `Desc`
- `aiSummaryCleansingLinkPara` / `Desc`
- `aiSummaryCleansingEnhancedHidden` / `Desc`
- `aiSummaryCleansingEmptyElem` / `Desc`
- `aiSummaryCleansingJPLayout` / `Desc`
- `aiSummaryCleansingJPNavigation` / `Desc`
- `aiSummaryCleansingAuthor` / `Desc`
- `aiSummaryCleansingSocial` / `Desc`

---

## 実装優先順位

1. **基盤:** ストレージキー、インターフェース更新
2. **既存強化:** enhancedHidden, emptyElem, linkDensity (既定true)
3. **数値ベース:** textDensity, shortSeq, symbolLine, linkPara
4. **日本特有:** jpLayout, jpNavigation, author, social
5. **ダッシュボードUI:** 設定画面更新
6. **テスト:** 各関数のユニットテスト
7. **i18n:** 翻訳キー追加

---

## リスクと対策

| リスク | 対策 |
|--------|------|
| 誤検知による有益なコンテンツの削除 | 既定値をfalseにし、ユーザーは明示的に有効化 |
| 数値ベースルールのサイト間差異 | 閾値を定数として外部化、調整可能に |
| 処理速度低下 | 必要最小限のDOM走査、Set使った重複排除 |
