# クレンジング機能拡張デザイン / Cleansing Enhancement Design

**対象**: AI Summary Cleansing 機能拡張
**日付**: 2026-04-04
**目的**: Token削減のため、日本の上位100サイトに見られる広告・ノイズ要素を更加に清理

---

## 日本語

### 背景

現在のAI Summary Cleansing機能（ CLEANSING_ORDER.md 参照）は、一般的な广告・导航・ソーシャルウィジェットのパターンを删除していますが、日本の广告密度の高いTop100サイトでは以下の问题が残っています:

- 固定位置の追従バナー（Yahoo!、Game8）
- 推荐セクション（「あわせて読みたい」「関連する商品」等）
- ページ分割された記事（Modelプレス等）
- SNSプロモート投稿・スポンサー製品（Twitter/X、Amazon）
- ポップアップ（Ameba、Amazon延长保证）
- プラットフォーム固有の噪声（5chのbe画像、YouTubeコメント欄等）

これらの要素はToken数を不必要に増加させ、AI要約の質を低下させます。

### 目标

- Token使用量を最大50%削減（网站による）
- ユーザーが必要な清理レベルを选べる
- 日本Top100 사이트への特殊対応

### アーキテクチャ

```
AI Summary Cleansing
├── 既存オプション（継承・拡張）
│   ├── alt属性削除 ✓
│   ├── メタデータ削除 ✓
│   ├── 広告削除 ✓
│   ├── ナビゲーション削除 ✓
│   ├── ソーシャル削除 ✓
│   └── ディープクレンジング（拡張）← 特殊パターンを追加
│
└── 新規独立オプション（6つ）
    ├── 固定要素削除
    ├── 推荐セクション削除
    ├── ページネーション削除
    ├── SNSプロモ削除
    ├── ポップアップ削除
    └── プラットフォーム噪声削除
```

### 新規オプションの詳細

#### 1. 固定要素削除（Fixed Element Removal）

**デフォルト**: 無効

| 削除対象 | CSSセレクター/パターン |
|---------|----------------------|
| position:fixed | `[style*="position: fixed"], [style*="position:fixed"]` |
| position:sticky | `[style*="position: sticky"], [style*="position:sticky"]` |
| position:absolute + top/bottom 0 | 画面端の固定バナー |
| 固定動画プレーヤー | `.fixed-video, [class*="sticky-player"]` |

**実装**: `stripFixedElements()` 函数、style属性のパースによる检测

#### 2. 推荐セクション削除（Recommended Section Removal）

**デフォルト**: 有効

| 削除対象 | クラス/IDパターン |
|---------|-------------------|
| あわせて読みたい | `ichiran, yoyaku, kanren, osusume` |
| 関連する商品 | `carousel, slider, recommend-item, product-carousel` |
| おすすめ記事 | `pickup, feature, ranking, trending` |
| あなたへのおすすめ | `for-you, personalized, recommendation-box` |

**実装**: `stripRecommendSections()` 函数、既存DEEP_CLASS_PATTERNSとの重複避免

#### 3. ページネーション削除（Pagination Removal）

**デフォルト**: 無効

| 削除対象 | クラス/IDパターン |
|---------|-------------------|
| 次へ/前のボタン | `next, prev, pager, page-nav` |
| ページ番号 | `page-numbers, pagination-numbers` |
| 「1 2 3 ...」UI | `[class*="pagination"]` |
| 无限滚动_LOAD_MORE | `load-more, infinite-scroll-trigger` |

**実装**: `stripPaginationElements()` 函数

#### 4. SNSプロモ删除（SNS Promotional Content Removal）

**デフォルト**: 無効

| 削除対象 | プラットフォーム |
|---------|-----------------|
| Twitter/X プロモート投稿 | `[data-testid="promotedIndicator"], [class*="promoted"]` |
| Twitter/X トレンド | `[aria-label="Trending now"], .trend-item` |
| Amazon スポンサー製品 | `.sp-cc, [class*="sponsored"], #sp-cc` |
| Amazon 「関連商品」カルーセル | `.a-carousel-container, [id*="sp-RELATED"]` |

**実装**: `stripSnsPromoElements()` 函数

#### 5. ポップアップ削除（Popup/Modal Removal）

**デフォルト**: 有効

| 削除対象 | パターン |
|---------|---------|
| Ameba フォローポップアップ | `.ameba-popup, [class*="follow-prompt"]` |
| Amazon 延長保証ポップアップ | `.spc-overlay, #spc-overlay, [class*="warranty-popup"]` |
| 汎用ポップアップ | `.popup-overlay, .modal-backdrop, [class*="modal"][style*="display"]` |
| お知らせトースト | `.toast-notification, .snackbar` |

**実装**: `stripPopupElements()` 函数、既存の`stripDeepElements()`と重複避免

#### 6. プラットフォーム噪声削除（Platform-Specific Noise Removal）

**デフォルト**: 無効

| プラットフォーム | 削除対象 |
|----------------|---------|
| 5ch/be | `.be-image, #be-profile, .mona, .since` |
| YouTube | `#comments, #related, .ytd-watch-flexy .secondary` |
| TVer | `.tver-overlay, .player-overlay` |
| ニコニコ動画 | `.nico-external-banner, .ndm-ads` |
| Yahoo! JAPAN | `#weather, #ranking, [id*="yahoo-ad"]` |

**実装**: `stripPlatformNoise()` 函数

### ディープクレンジングの拡張

既存のままにせず、以下の特殊パターンを追加:

```typescript
const EXTENDED_DEEP_PATTERNS = [
    // Amazon特化
    'sp-cc', 'sponsored-products', 'ad-hover', 'product-ads',
    // 5ch特化
    'be-', 'mona', 'since', '2chmate',
    // YouTube特化
    'ytp-', 'ytd-companion', 'video-ads',
    // カルーセル/スライダー
    'carousel-container', 'slick-track', 'swiper-wrapper',
    // ページ分割过多
    'page-selector', 'article-pagination', 'multi-page',
];
```

### 設定storage

```typescript
// storage.ts に新規キーを追加
AI_SUMMARY_CLEANSING_FIXED: 'ai_summary_cleansing_fixed',
AI_SUMMARY_CLEANSING_RECOMMEND: 'ai_summary_cleansing_recommend',
AI_SUMMARY_CLEANSING_PAGINATION: 'ai_summary_cleasing_pagination',
AI_SUMMARY_CLEANSING_SNS_PROMO: 'ai_summary_cleasing_sns_promo',
AI_SLEMENT_CLEANSING_POPUP: 'ai_summary_cleasing_popup',
AI_SUMMARY_CLEANSING_PLATFORM: 'ai_summary_cleasing_platform',
```

### Dashboard UI

AI Summary Cleansing設定タブに新规セクションを追加:

```
▼ 高度清理オプション（新規）
[ ] 固定要素削除（position:fixed/sticky）
[x] 推荐セクション削除
[ ] ページネーション削除
[ ] SNSプロモ削除
[x] ポップアップ削除
[ ] プラットフォーム噪声削除
```

### テスト戦略

1. 各新建函数的单元测试
2. 日本のTop20 网站を対象とした手动测试
3. 既存のcleansingテストへの影響確認
4. Token削減率の测定（Before/After）

---

## English

### Background

Current AI Summary Cleansing (see CLEANSING_ORDER.md) removes common ad, navigation, and social widget patterns, but Japanese top 100 sites with high ad density still have issues:

- Sticky/fixed banners (Yahoo!, Game8)
- Recommendation sections ("Related articles", "Recommended products")
- Paginated articles (Model Press, etc.)
- SNS promoted posts / sponsored products (Twitter/X, Amazon)
- Popups (Ameba, Amazon warranty)
- Platform-specific noise (5ch be images, YouTube comments, etc.)

These elements unnecessarily increase token count and reduce AI summary quality.

### Goal

- Reduce token usage by up to 50% (varies by site)
- Allow users to choose desired cleansing level
- Special handling for Japanese Top 100 sites

### Architecture

```
AI Summary Cleansing
├── Existing Options (inherited/extended)
│   ├── alt attribute removal ✓
│   ├── metadata removal ✓
│   ├── ad removal ✓
│   ├── navigation removal ✓
│   ├── social widget removal ✓
│   └── deep cleansing (extended) ← add special patterns
│
└── New Independent Options (6)
    ├── Fixed element removal
    ├── Recommendation section removal
    ├── Pagination removal
    ├── SNS promo removal
    ├── Popup removal
    └── Platform-specific noise removal
```

### New Option Details

#### 1. Fixed Element Removal

**Default**: Disabled

| Target | CSS Selector/Pattern |
|--------|---------------------|
| position:fixed | `[style*="position: fixed"], [style*="position:fixed"]` |
| position:sticky | `[style*="position: sticky"], [style*="position:sticky"]` |
| Absolute positioned at top/bottom | Screen-edge banners |
| Fixed video player | `.fixed-video, [class*="sticky-player"]` |

**Implementation**: `stripFixedElements()` function, style attribute parsing

#### 2. Recommendation Section Removal

**Default**: Enabled

| Target | Class/ID Patterns |
|--------|-------------------|
| "Related articles" | `ichiran, yoyaku, kanren, osusume` |
| "Related products" | `carousel, slider, recommend-item, product-carousel` |
| "Recommended articles" | `pickup, feature, ranking, trending` |
| "For you" | `for-you, personalized, recommendation-box` |

**Implementation**: `stripRecommendSections()` function, avoid duplication with existing DEEP_CLASS_PATTERNS

#### 3. Pagination Removal

**Default**: Disabled

| Target | Class/ID Patterns |
|--------|-------------------|
| Next/Prev buttons | `next, prev, pager, page-nav` |
| Page numbers | `page-numbers, pagination-numbers` |
| "1 2 3 ..." UI | `[class*="pagination"]` |
| Infinite scroll / Load more | `load-more, infinite-scroll-trigger` |

**Implementation**: `stripPaginationElements()` function

#### 4. SNS Promo Removal

**Default**: Disabled

| Target | Platform |
|--------|----------|
| Twitter/X promoted posts | `[data-testid="promotedIndicator"], [class*="promoted"]` |
| Twitter/X trends | `[aria-label="Trending now"], .trend-item` |
| Amazon sponsored products | `.sp-cc, [class*="sponsored"], #sp-cc` |
| Amazon "Related products" carousel | `.a-carousel-container, [id*="sp-RELATED"]` |

**Implementation**: `stripSnsPromoElements()` function

#### 5. Popup/Modal Removal

**Default**: Enabled

| Target | Pattern |
|--------|---------|
| Ameba follow popup | `.ameba-popup, [class*="follow-prompt"]` |
| Amazon warranty popup | `.spc-overlay, #spc-overlay, [class*="warranty-popup"]` |
| Generic popups | `.popup-overlay, .modal-backdrop, [class*="modal"][style*="display"]` |
| Notification toasts | `.toast-notification, .snackbar` |

**Implementation**: `stripPopupElements()` function, avoid duplication with existing `stripDeepElements()`

#### 6. Platform-Specific Noise Removal

**Default**: Disabled

| Platform | Target |
|----------|--------|
| 5ch/be | `.be-image, #be-profile, .mona, .since` |
| YouTube | `#comments, #related, .ytd-watch-flexy .secondary` |
| TVer | `.tver-overlay, .player-overlay` |
| ニコニコ動画 | `.nico-external-banner, .ndm-ads` |
| Yahoo! JAPAN | `#weather, #ranking, [id*="yahoo-ad"]` |

**Implementation**: `stripPlatformNoise()` function

### Deep Cleansing Extension

Add special patterns to existing deep cleansing:

```typescript
const EXTENDED_DEEP_PATTERNS = [
    // Amazon-specific
    'sp-cc', 'sponsored-products', 'ad-hover', 'product-ads',
    // 5ch-specific
    'be-', 'mona', 'since', '2chmate',
    // YouTube-specific
    'ytp-', 'ytd-companion', 'video-ads',
    // Carousel/slider
    'carousel-container', 'slick-track', 'swiper-wrapper',
    // Excessive page splits
    'page-selector', 'article-pagination', 'multi-page',
];
```

### Storage Keys

```typescript
// Add to storage.ts
AI_SUMMARY_CLEANSING_FIXED: 'ai_summary_cleansing_fixed',
AI_SUMMARY_CLEANSING_RECOMMEND: 'ai_summary_cleansing_recommend',
AI_SUMMARY_CLEANSING_PAGINATION: 'ai_summary_cleasing_pagination',
AI_SUMMARY_CLEANSING_SNS_PROMO: 'ai_summary_cleasing_sns_promo',
AI_SUMMARY_CLEANSING_POPUP: 'ai_summary_cleasing_popup',
AI_SUMMARY_CLEANSING_PLATFORM: 'ai_summary_cleasing_platform',
```

### Dashboard UI

Add new section in AI Summary Cleansing settings tab:

```
▼ Advanced Cleansing Options (New)
[ ] Fixed element removal (position:fixed/sticky)
[x] Recommendation section removal
[ ] Pagination removal
[ ] SNS promo removal
[x] Popup removal
[ ] Platform-specific noise removal
```

### Testing Strategy

1. Unit tests for each new function
2. Manual testing against Japanese Top 20 sites
3. Verify no impact on existing cleansing tests
4. Measure token reduction rate (Before/After)