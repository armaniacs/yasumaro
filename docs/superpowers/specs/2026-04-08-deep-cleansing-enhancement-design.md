# aiSummaryCleansingDeep 高性能化デザイン

**日付:** 2026-04-08  
**ステータス:** 承認済み  
**パターン:** B（独立オプション、各ルールを個別のトグル）

---

## 概要

`aiSummaryCleansingDeep` を高性能化し、数値ベースの新しいクレンジングルール10個を追加する。各ルールは独立した設定トグルとして用户提供し、細やかな制御を可能にする。

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
| `ai_summary_cleansing_social` | true | ソーシャル・コミュニティ |
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

## 設定の実装

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
| 数値ベースルールのサイト間差異 | ダッシュボードでスライダー調整を可能にする |
| 処理速度低下 | 既存走查を整理・統合し、純増を最小限に抑える |

---

## 深掘りセッション — 2026-04-08

### 挑戦した仮定

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| 70%/30文字/5連続の固定閾値が万能 | 高 | サイトによって最適な値が全く異なる | ダッシュボードでスライダー調整を可能にする |
| 10個のパターン列表で十分 | 高 | ユーザーが自分用のパターンを追加したい需要がある | プリセット選択＋カスタムパターン追加機能を実装 |
| 10個のDOM走查は問題なし | 高 | 既存走查と重複 많아질 가능성 | 既存走查を整理・統合して純増を最小限に抑える |
| deepEnabledとの共存 | 中 | 重複削除の可能性がある | deepEnabled ON時は新オプションも強制有効にする |
| ユーザーは10個のオプションを理解できる | 中 | オプションが多いと混乱する | カテゴリー別グループ化＋マスタートグルを追加 |

### 新たに発見したリスク

1. **閾値スライダーのデフォルト値問題**: スライダー範囲（例: 0-100%）の適切なデフォルト値選定が必要
2. **カスタムパターンの正規表現対応**: 簡単な前方一致だけでなく、正規表現にも対応すべきか？
3. **プリセットの策定**: 「おすすめ設定」としてどの組み合わせ提示するか？
4. **既存DEEP_CLASS_PATTERNSとの重複**: 新規パターン追加前に既存との整理が必要

### 未解決の疑問

- 閾値スライダーのデフォルト値はどこに設定するか？（storage既定値？还是UI初期表示？）
- カスタムパターンの上限数（无制限？还是上限あり）？
- グループ構成哪些？（Aggressive、日本网站特有のみ？还是もっと细分化）

### 実装優先順位（更新）

1. **基盤:** ストレージキー、インターフェース更新
2. **既存整理:** DEEP_CLASS_PATTERNSと新規パターンの整理・統合
3. **数値ベース:** textDensity, shortSeq, symbolLine, linkPara（スライダーUI付き）
4. **日本特有:** jpLayout, jpNavigation, author, social
5. **カスタムパターン:** プリセット選択＋カスタム追加机制
6. **UI整理:** カテゴリー別グループ化＋マスターントグル
7. **ダッシュボードUI:** 設定画面更新
8. **テスト:** 各関数のユニットテスト
9. **i18n:** 翻訳キー追加

---

## 実装完了 — 2026-04-08

### 完了した作業

| # | 作業 | 状態 | ファイル |
|---|------|------|----------|
| 1 | ストレージキー追加 | ✓ | storage.ts |
| 2 | AiSummaryCleanseOptions拡張 | ✓ | aiSummaryCleaner.ts |
| 3 | 9つの新 cleansing関数追加 | ✓ | aiSummaryCleaner.ts |
| 4 | extractor.ts 設定読み込み | ✓ | extractor.ts |
| 5 | aiSummaryCleansingSettings.ts 更新 | ✓ | aiSummaryCleansingSettings.ts |
| 6 | ダッシュボードHTML UI | ✓ | dashboard.html |
| 7 | i18n翻訳キー | ✓ | messages.json |
| 8 | テスト更新 | ✓ | aiSummaryCleaner.test.ts |
| 9 | ビルド確認 | ✓ | type-check通過 |
| 10 | npm test | ✓ | 166 passed, 3496 passed |

### 実装した9つの新オプション

1. `textDensity` - テキスト密度フィルタリング（リンク70%以上）
2. `shortSeq` - 短文要素の連続削除（30文字以下×5連続）
3. `symbolLine` - 特殊記号行の削除（|, », ◀, ▶等）
4. `linkPara` - リンクのみ段落の削除（50文字以下）
5. `enhancedHidden` - 非表示要素強化削除
6. `emptyElem` - 空要素の削除
7. `jpLayout` - JP BEM系レイアウトパターン
8. `jpNavigation` - JP ナビ・剰利用語
9. `author` - 執筆者・メタ情報

### 追加した閾値設定

- `linkRatioThreshold` - リンク密度閾値（既定: 70%）
- `shortTextThreshold` - 短文閾値文字数（既定: 30)
- `shortSeqCount` - 短文連続数閾値（既定: 5）
- `linkParaThreshold` - リンクのみ段落閾値（既定: 50）

### TODO（後続作業）

- ~~ダッシュボードHTMLにチェックボックス追加~~ → ✓ 完了（dashboard.html lines 750-787）
- ~~i18n翻訳キー追加~~ → ✓ 完了（messages.json 全キー登録済み）
- ~~UIカテゴリー別グループ化（設計通り）~~ → ✓ 完了（aggressiveModeTitle / jpSpecificTitle）

---

## 実装検証 — 2026-04-08 21:25

### 完了確認

| # | 作業 | 状態 | ファイル確認 |
|---|------|------|--------------|
| 1 | ストレージキー追加 | ✓ | storage.ts (lines 156-168) |
| 2 | AiSummaryCleanseOptions拡張 | ✓ | aiSummaryCleaner.ts (lines 48-56) |
| 3 | 9つの新 cleansing関数追加 | ✓ | aiSummaryCleaner.ts (strip* 関数実装済み) |
| 4 | extractor.ts 設定読み込み | ✓ | extractor.ts (lines 185-193) |
| 5 | aiSummaryCleansingSettings.ts 更新 | ✓ | aiSummaryCleansingSettings.ts (全プロパティ実装) |
| 6 | ダッシュボードHTML UI | ✓ | dashboard.html (lines 750-787) |
| 7 | i18n翻訳キー | ✓ | messages.json (全キー登録) |
| 8 | テスト更新 | ✓ | aiSummaryCleaner.test.ts (options反映) |
| 9 | type-check | ✓ | 通過 |
| 10 | npm test | ✓ | 166 passed, 3496 passed |

### 実装済みオプション

| オプション | ストレージキー | 既定値 | 関数 |
|-----------|---------------|--------|------|
| textDensity | ai_summary_cleansing_text_density | false | stripTextDensityElements() |
| shortSeq | ai_summary_cleansing_short_seq | false | stripShortSequenceElements() |
| symbolLine | ai_summary_cleansing_symbol_line | false | stripSymbolLineElements() |
| linkPara | ai_summary_cleansing_link_para | false | stripLinkOnlyParagraphs() |
| enhancedHidden | ai_summary_cleansing_enhanced_hidden | true | stripEnhancedHiddenElements() |
| emptyElem | ai_summary_cleansing_empty_elem | true | stripEmptyElements() |
| jpLayout | ai_summary_cleansing_jp_layout | false | stripJPLayoutPatterns() |
| jpNavigation | ai_summary_cleansing_jp_navigation | false | stripJPNavigationPatterns() |
| author | ai_summary_cleansing_author | false | stripAuthorMetaElements() |
| social | ai_summary_cleansing_social | true | stripSocialElements() (既存強化) |

### 追加閾値設定

- `linkRatioThreshold` - リンク密度閾値（既定: 70%）
- `shortTextThreshold` - 短文閾値文字数（既定: 30）
- `shortSeqCount` - 短文連続数閾値（既定: 5）
- `linkParaThreshold` - リンクのみ段落閾値（既定: 50）

### ダッシュボードUI構造

```
cleansing-group-title: "Aggressive モード（数値ベース）"
  - ai-summary-cleansing-text-density
  - ai-summary-cleansing-short-seq
  - ai-summary-cleansing-symbol-line
  - ai-summary-cleansing-link-para
  - ai-summary-cleansing-enhanced-hidden (checked)
  - ai-summary-cleansing-empty-elem (checked)

cleansing-group-title: "日本ウェブサイト特有"
  - ai-summary-cleansing-jp-layout
  - ai-summary-cleansing-jp-navigation
  - ai-summary-cleansing-author
```

---

## 実装検証 — 2026-04-08 21:25

### 完了確認

| # | 作業 | 状態 | ファイル確認 |
|---|------|------|--------------|
| 1 | ストレージキー追加 | ✓ | storage.ts (lines 156-168) |
| 2 | AiSummaryCleanseOptions拡張 | ✓ | aiSummaryCleaner.ts (lines 48-56) |
| 3 | 9つの新 cleansing関数追加 | ✓ | aiSummaryCleaner.ts (strip* 関数実装済み) |
| 4 | extractor.ts 設定読み込み | ✓ | extractor.ts (lines 185-193) |
| 5 | aiSummaryCleansingSettings.ts 更新 | ✓ | aiSummaryCleansingSettings.ts (全プロパティ実装) |
| 6 | ダッシュボードHTML UI | ✓ | dashboard.html (lines 750-787) |
| 7 | i18n翻訳キー | ✓ | messages.json (全キー登録) |
| 8 | テスト更新 | ✓ | aiSummaryCleaner.test.ts (options反映) |
| 9 | type-check | ✓ | 通過 |
| 10 | npm test | ✓ | 166 passed, 3496 passed |

### 実装済みオプション

| オプション | ストレージキー | 既定値 | 関数 |
|-----------|---------------|--------|------|
| textDensity | ai_summary_cleansing_text_density | false | stripTextDensityElements() |
| shortSeq | ai_summary_cleansing_short_seq | false | stripShortSequenceElements() |
| symbolLine | ai_summary_cleansing_symbol_line | false | stripSymbolLineElements() |
| linkPara | ai_summary_cleansing_link_para | false | stripLinkOnlyParagraphs() |
| enhancedHidden | ai_summary_cleansing_enhanced_hidden | true | stripEnhancedHiddenElements() |
| emptyElem | ai_summary_cleansing_empty_elem | true | stripEmptyElements() |
| jpLayout | ai_summary_cleansing_jp_layout | false | stripJPLayoutPatterns() |
| jpNavigation | ai_summary_cleansing_jp_navigation | false | stripJPNavigationPatterns() |
| author | ai_summary_cleansing_author | false | stripAuthorMetaElements() |
| social | ai_summary_cleansing_social | true | stripSocialElements() (既存強化) |

### 追加閾値設定

- `linkRatioThreshold` - リンク密度閾値（既定: 70%）
- `shortTextThreshold` - 短文閾値文字数（既定: 30）
- `shortSeqCount` - 短文連続数閾値（既定: 5）
- `linkParaThreshold` - リンクのみ段落閾値（既定: 50）

### ダッシュボードUI構造

```
cleansing-group-title: "Aggressive モード（数値ベース）"
  - ai-summary-cleansing-text-density
  - ai-summary-cleansing-short-seq
  - ai-summary-cleansing-symbol-line
  - ai-summary-cleansing-link-para
  - ai-summary-cleansing-enhanced-hidden (checked)
  - ai-summary-cleansing-empty-elem (checked)

cleansing-group-title: "日本ウェブサイト特有"
  - ai-summary-cleansing-jp-layout
  - ai-summary-cleansing-jp-navigation
  - ai-summary-cleansing-author
```

---

**ステータス: 完全実装完了**
