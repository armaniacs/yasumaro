# Category B Cleansing Patterns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ニュース・EC・Q&A・動画プラットフォーム向けの4カテゴリ（B-1〜B-4）のAI要約クレンジングパターンを追加し、新規ユーザーにはデフォルトONで提供する。

**Architecture:** Category A（`stripJPLayoutPatterns`）と同じ構造で、`stripExtended.ts` に4つの独立した `strip*Patterns` 関数を追加する。各関数はパターン配列を `patterns.ts` に定義し、`buildClassIdSelectors()` でCSSセレクタ化、`safeRemoveElement()` で本文保護（bodyProtection）を考慮しながら要素を削除する。`types.ts` → `index.ts` → `contentExtractor/index.ts` → `src/content/extractor.ts` → `popup/aiSummaryCleansingSettingsV2.ts` の順に配線し、最後に `storage/defaults.ts` のデフォルト値と `migration.ts` の既存ユーザー向け移行処理を追加する。

**Tech Stack:** TypeScript, Jest + jsdom, Chrome Extension (Manifest V3), Vitest (`@vitest-environment jsdom` in strip系テスト)

---

## Task 1: パターン定数を patterns.ts に追加

**Files:**
- Modify: `src/utils/aiSummaryCleaner/patterns.ts`

- [ ] **Step 1: 4つの新規パターン配列定数を追加**

`src/utils/aiSummaryCleaner/patterns.ts` の末尾（`DEEP_ROLES` の後）に以下を追加する。

```typescript
/**
 * B-1: ニュースメディア固有パターン
 * コメント欄・関連記事カード・記者クレジット・速報タイムライン
 */
export const NEWS_MEDIA_PATTERNS = [
    // コメント欄・リアクション欄
    'disqus', 'yahoo-comment', 'comment-count',
    // 関連記事カード群
    'related-article-card', 'article-ranking', 'read-also',
    // 記者・配信元クレジット表記
    'article-credit', 'byline-source', 'delivery-source',
    // 速報・更新タイムライン表示
    'live-timestamp', 'update-timeline', 'breaking-badge',
];

/**
 * B-2: EC・通販固有パターン
 * レビュー・バリエーション選択・関連購入・送料バッジ
 */
export const EC_SITE_PATTERNS = [
    // レビュー・星評価欄
    'review-list', 'star-rating', 'review-count', 'rating-star',
    // バリエーション選択UI（色・サイズ・数量）
    'variation-selector', 'color-swatch', 'size-selector', 'quantity-selector',
    // 一緒に買われている商品
    'frequently-bought', 'also-bought', 'bought-together',
    // 送料・在庫・ポイント情報バッジ
    'shipping-badge', 'stock-badge', 'point-badge', 'free-shipping',
];

/**
 * B-3: Q&A・知恵袋固有パターン
 * ベストアンサー・関連質問・回答者プロフィール・いいねボタン
 */
export const QA_SITE_PATTERNS = [
    // ベストアンサー・解決済みマーク
    'best-answer-badge', 'resolved-mark', 'solved-badge',
    // 関連質問一覧
    'related-question-list', 'similar-question',
    // 回答者プロフィール・ランクバッジ
    'answerer-profile', 'answerer-rank', 'responder-badge',
    // 覚えておき・いいね数ボタン
    'helpful-count', 'good-answer-button',
];

/**
 * B-4: 動画プラットフォーム固有パターン
 * コメント弾幕・タグクラウド・関連動画・再生数バッジ
 */
export const VIDEO_SITE_PATTERNS = [
    // コメント弾幕・実況テキスト
    'nico-comment', 'danmaku', 'comment-flow',
    // タグクラウド・フォルダータグ
    'tag-cloud', 'folder-tag', 'video-tag-list',
    // 関連動画・次の動画カード一覧
    'related-video-card', 'next-video-list',
    // 再生回数・マイリスト登録数・会員限定バッジ
    'view-count-badge', 'mylist-count', 'member-only-badge',
];
```

- [ ] **Step 2: TypeScriptビルドを確認**

Run: `npm run type-check`
Expected: エラーなし（新規exportのみのため既存コードへの影響なし）

- [ ] **Step 3: Commit**

```bash
git add src/utils/aiSummaryCleaner/patterns.ts
git commit -m "feat(ai-summary-cleaning): Category B パターン定数を追加"
```

---

## Task 2: stripNewsMediaPatterns 関数の実装（TDD）

**Files:**
- Modify: `src/utils/aiSummaryCleaner/stripExtended.ts`
- Test: `src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts` の import 文に `stripNewsMediaPatterns` を追加し、既存の `describe('stripSpeechBubbles', ...)` ブロックの後に以下を追記する。

```typescript
// import文を以下に変更
import {
  stripFixedElements,
  stripRecommendSections,
  stripPaginationElements,
  stripSnsPromoElements,
  stripPopupElements,
  stripPlatformNoise,
  stripTextDensityElements,
  stripShortSequenceElements,
  stripSymbolLineElements,
  stripLinkOnlyParagraphs,
  stripEnhancedHiddenElements,
  stripEmptyElements,
  stripJPLayoutPatterns,
  stripJPNavigationPatterns,
  stripAuthorMetaElements,
  stripAffiliateElements,
  stripSpeechBubbles,
  stripNewsMediaPatterns,
} from '../stripExtended.js';
```

```typescript
describe('stripNewsMediaPatterns', () => {
    it('removes comment section elements', () => {
      root.innerHTML = '<div class="yahoo-comment">Comments</div><p>Article body</p>';
      const count = stripNewsMediaPatterns(root);
      expect(count).toBe(1);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('removes related article card elements', () => {
      root.innerHTML = '<div class="related-article-card">Read also</div><p>Article body</p>';
      const count = stripNewsMediaPatterns(root);
      expect(count).toBe(1);
    });

    it('removes article credit elements', () => {
      root.innerHTML = '<div class="byline-source">配信：共同通信</div><p>Article body</p>';
      const count = stripNewsMediaPatterns(root);
      expect(count).toBe(1);
    });

    it('removes live timestamp elements', () => {
      root.innerHTML = '<div class="update-timeline">19:32 更新</div><p>Article body</p>';
      const count = stripNewsMediaPatterns(root);
      expect(count).toBe(1);
    });

    it('does not remove normal article content', () => {
      root.innerHTML = '<p>This is a normal news article paragraph.</p>';
      const count = stripNewsMediaPatterns(root);
      expect(count).toBe(0);
    });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx jest src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts -t "stripNewsMediaPatterns"`
Expected: FAIL — `stripNewsMediaPatterns is not a function` または import エラー

- [ ] **Step 3: 最小実装を書く**

`src/utils/aiSummaryCleaner/stripExtended.ts` の import 文を更新する。

```typescript
import { buildClassIdSelectors, isFixedOrSticky, isLikelyAd, isLikelyPopup, isPlatformNoise, safeRemoveElement, safeReplaceWithText } from './helpers.js';
import { NEWS_MEDIA_PATTERNS, EC_SITE_PATTERNS, QA_SITE_PATTERNS, VIDEO_SITE_PATTERNS } from './patterns.js';
```

ファイル末尾（`stripSpeechBubbles` 関数の後）に以下を追加する。

```typescript
/**
 * ニュースメディア固有パターンを削除（Category B-1）
 * コメント欄・関連記事カード・記者クレジット・速報タイムライン
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripNewsMediaPatterns(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    element.querySelectorAll(buildClassIdSelectors(NEWS_MEDIA_PATTERNS)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        if (safeRemoveElement(elem)) { removedCount++; }
    }
    return removedCount;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx jest src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts -t "stripNewsMediaPatterns"`
Expected: PASS（5件全て）

- [ ] **Step 5: Commit**

```bash
git add src/utils/aiSummaryCleaner/stripExtended.ts src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts
git commit -m "feat(ai-summary-cleaning): stripNewsMediaPatterns を追加（Category B-1）"
```

---

## Task 3: stripEcSitePatterns 関数の実装（TDD）

**Files:**
- Modify: `src/utils/aiSummaryCleaner/stripExtended.ts`
- Test: `src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

import 文に `stripEcSitePatterns` を追加し、Task 2 で追加した `describe('stripNewsMediaPatterns', ...)` の後に以下を追記する。

```typescript
describe('stripEcSitePatterns', () => {
    it('removes review list elements', () => {
      root.innerHTML = '<div class="review-list">Reviews (1,234)</div><p>Product description</p>';
      const count = stripEcSitePatterns(root);
      expect(count).toBe(1);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('removes variation selector elements', () => {
      root.innerHTML = '<div class="color-swatch">Color options</div><p>Product description</p>';
      const count = stripEcSitePatterns(root);
      expect(count).toBe(1);
    });

    it('removes frequently bought together elements', () => {
      root.innerHTML = '<div class="frequently-bought">Frequently bought together</div><p>Product description</p>';
      const count = stripEcSitePatterns(root);
      expect(count).toBe(1);
    });

    it('removes shipping badge elements', () => {
      root.innerHTML = '<div class="free-shipping">送料無料</div><p>Product description</p>';
      const count = stripEcSitePatterns(root);
      expect(count).toBe(1);
    });

    it('does not remove normal product description', () => {
      root.innerHTML = '<p>This is a normal product description paragraph.</p>';
      const count = stripEcSitePatterns(root);
      expect(count).toBe(0);
    });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx jest src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts -t "stripEcSitePatterns"`
Expected: FAIL — `stripEcSitePatterns is not a function`

- [ ] **Step 3: 最小実装を書く**

`src/utils/aiSummaryCleaner/stripExtended.ts` の `stripNewsMediaPatterns` の後に追加する。

```typescript
/**
 * EC・通販固有パターンを削除（Category B-2）
 * レビュー・バリエーション選択・関連購入・送料バッジ
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripEcSitePatterns(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    element.querySelectorAll(buildClassIdSelectors(EC_SITE_PATTERNS)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        if (safeRemoveElement(elem)) { removedCount++; }
    }
    return removedCount;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx jest src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts -t "stripEcSitePatterns"`
Expected: PASS（5件全て）

- [ ] **Step 5: Commit**

```bash
git add src/utils/aiSummaryCleaner/stripExtended.ts src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts
git commit -m "feat(ai-summary-cleaning): stripEcSitePatterns を追加（Category B-2）"
```

---

## Task 4: stripQaSitePatterns 関数の実装（TDD）

**Files:**
- Modify: `src/utils/aiSummaryCleaner/stripExtended.ts`
- Test: `src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

import 文に `stripQaSitePatterns` を追加し、Task 3 の `describe('stripEcSitePatterns', ...)` の後に追記する。

```typescript
describe('stripQaSitePatterns', () => {
    it('removes best answer badge elements', () => {
      root.innerHTML = '<div class="best-answer-badge">ベストアンサー</div><p>回答本文です</p>';
      const count = stripQaSitePatterns(root);
      expect(count).toBe(1);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('removes related question list elements', () => {
      root.innerHTML = '<div class="related-question-list">この質問も見られています</div><p>回答本文です</p>';
      const count = stripQaSitePatterns(root);
      expect(count).toBe(1);
    });

    it('removes answerer profile elements', () => {
      root.innerHTML = '<div class="answerer-rank">回答数123</div><p>回答本文です</p>';
      const count = stripQaSitePatterns(root);
      expect(count).toBe(1);
    });

    it('removes helpful count button elements', () => {
      root.innerHTML = '<button class="helpful-count">いいね(45)</button><p>回答本文です</p>';
      const count = stripQaSitePatterns(root);
      expect(count).toBe(1);
    });

    it('does not remove normal answer content', () => {
      root.innerHTML = '<p>This is a normal Q&A answer paragraph.</p>';
      const count = stripQaSitePatterns(root);
      expect(count).toBe(0);
    });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx jest src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts -t "stripQaSitePatterns"`
Expected: FAIL — `stripQaSitePatterns is not a function`

- [ ] **Step 3: 最小実装を書く**

`src/utils/aiSummaryCleaner/stripExtended.ts` の `stripEcSitePatterns` の後に追加する。

```typescript
/**
 * Q&A・知恵袋固有パターンを削除（Category B-3）
 * ベストアンサー・関連質問・回答者プロフィール・いいねボタン
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripQaSitePatterns(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    element.querySelectorAll(buildClassIdSelectors(QA_SITE_PATTERNS)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        if (safeRemoveElement(elem)) { removedCount++; }
    }
    return removedCount;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx jest src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts -t "stripQaSitePatterns"`
Expected: PASS（5件全て）

- [ ] **Step 5: Commit**

```bash
git add src/utils/aiSummaryCleaner/stripExtended.ts src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts
git commit -m "feat(ai-summary-cleaning): stripQaSitePatterns を追加（Category B-3）"
```

---

## Task 5: stripVideoSitePatterns 関数の実装（TDD）

**Files:**
- Modify: `src/utils/aiSummaryCleaner/stripExtended.ts`
- Test: `src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

import 文に `stripVideoSitePatterns` を追加し、Task 4 の `describe('stripQaSitePatterns', ...)` の後に追記する。

```typescript
describe('stripVideoSitePatterns', () => {
    it('removes nico comment elements', () => {
      root.innerHTML = '<div class="nico-comment">弾幕コメント</div><p>Video description</p>';
      const count = stripVideoSitePatterns(root);
      expect(count).toBe(1);
      expect(root.querySelector('p')).not.toBeNull();
    });

    it('removes tag cloud elements', () => {
      root.innerHTML = '<div class="tag-cloud">タグ一覧</div><p>Video description</p>';
      const count = stripVideoSitePatterns(root);
      expect(count).toBe(1);
    });

    it('removes related video card elements', () => {
      root.innerHTML = '<div class="related-video-card">関連動画</div><p>Video description</p>';
      const count = stripVideoSitePatterns(root);
      expect(count).toBe(1);
    });

    it('removes view count badge elements', () => {
      root.innerHTML = '<div class="view-count-badge">再生回数 6.7万回</div><p>Video description</p>';
      const count = stripVideoSitePatterns(root);
      expect(count).toBe(1);
    });

    it('does not remove normal video description', () => {
      root.innerHTML = '<p>This is a normal video description paragraph.</p>';
      const count = stripVideoSitePatterns(root);
      expect(count).toBe(0);
    });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx jest src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts -t "stripVideoSitePatterns"`
Expected: FAIL — `stripVideoSitePatterns is not a function`

- [ ] **Step 3: 最小実装を書く**

`src/utils/aiSummaryCleaner/stripExtended.ts` の `stripQaSitePatterns` の後に追加する。

```typescript
/**
 * 動画プラットフォーム固有パターンを削除（Category B-4）
 * コメント弾幕・タグクラウド・関連動画・再生数バッジ
 * @param element - クレンジング対象のルート要素
 * @returns 削除した要素の数
 */
export function stripVideoSitePatterns(element: Element): number {
    let removedCount = 0;
    const elementsToRemove: Element[] = [];
    const counted = new Set<Element>();

    element.querySelectorAll(buildClassIdSelectors(VIDEO_SITE_PATTERNS)).forEach(elem => {
        if (!counted.has(elem)) {
            elementsToRemove.push(elem);
            counted.add(elem);
        }
    });

    for (const elem of elementsToRemove) {
        if (safeRemoveElement(elem)) { removedCount++; }
    }
    return removedCount;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx jest src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts -t "stripVideoSitePatterns"`
Expected: PASS（5件全て）

- [ ] **Step 5: 陰性テスト（既存パターンとの非重複確認）を追加**

`src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts` の末尾（最後の `describe` ブロックの後）に以下を追記する。

```typescript
describe('Category B patterns do not overlap with existing generic patterns', () => {
    it('NEWS_MEDIA_PATTERNS does not contain generic words already in CARD_PATTERNS or DEEP_CLASS_PATTERNS', () => {
      const genericWords = ['ranking', 'related', 'card', 'comment', 'author'];
      const overlaps = NEWS_MEDIA_PATTERNS.filter(p => genericWords.includes(p));
      expect(overlaps).toEqual([]);
    });

    it('EC_SITE_PATTERNS does not contain generic words already in CARD_PATTERNS or DEEP_CLASS_PATTERNS', () => {
      const genericWords = ['ranking', 'related', 'card', 'comment', 'author'];
      const overlaps = EC_SITE_PATTERNS.filter(p => genericWords.includes(p));
      expect(overlaps).toEqual([]);
    });

    it('QA_SITE_PATTERNS does not contain generic words already in CARD_PATTERNS or DEEP_CLASS_PATTERNS', () => {
      const genericWords = ['ranking', 'related', 'card', 'comment', 'author'];
      const overlaps = QA_SITE_PATTERNS.filter(p => genericWords.includes(p));
      expect(overlaps).toEqual([]);
    });

    it('VIDEO_SITE_PATTERNS does not contain generic words already in CARD_PATTERNS or DEEP_CLASS_PATTERNS', () => {
      const genericWords = ['ranking', 'related', 'card', 'comment', 'author'];
      const overlaps = VIDEO_SITE_PATTERNS.filter(p => genericWords.includes(p));
      expect(overlaps).toEqual([]);
    });
});
```

このテストが `NEWS_MEDIA_PATTERNS` 等を参照できるよう、ファイル冒頭の import 文に以下を追加する。

```typescript
import { NEWS_MEDIA_PATTERNS, EC_SITE_PATTERNS, QA_SITE_PATTERNS, VIDEO_SITE_PATTERNS } from '../patterns.js';
```

- [ ] **Step 6: 全テストを実行して確認**

Run: `npx jest src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts`
Expected: PASS（全件）

- [ ] **Step 7: Commit**

```bash
git add src/utils/aiSummaryCleaner/stripExtended.ts src/utils/aiSummaryCleaner/__tests__/stripExtended.test.ts
git commit -m "feat(ai-summary-cleaning): stripVideoSitePatterns を追加（Category B-4）+ 非重複陰性テスト"
```

---

## Task 6: 型定義（types.ts）に4オプションを追加

**Files:**
- Modify: `src/utils/aiSummaryCleaner/types.ts`

- [ ] **Step 1: AiSummaryCleanseOptions に4オプションを追加**

`src/utils/aiSummaryCleaner/types.ts` の `speechBubbleEnabled?: boolean;` の行の直後に追加する。

```typescript
    // Category B: Site-Type Specific Patterns (News/EC/QA/Video)
    newsMediaEnabled?: boolean;       // ニュースメディア固有パターン（デフォルト: false）
    ecSiteEnabled?: boolean;          // EC・通販固有パターン（デフォルト: false）
    qaSiteEnabled?: boolean;          // Q&A・知恵袋固有パターン（デフォルト: false）
    videoSiteEnabled?: boolean;       // 動画プラットフォーム固有パターン（デフォルト: false）
```

- [ ] **Step 2: AiSummaryCleanseResult に4フィールドを追加**

`src/utils/aiSummaryCleaner/types.ts` の `speechBubbleRemoved?: number;` の行の直後に追加する。

```typescript
    // Category B: Site-Type Specific Patterns (News/EC/QA/Video)
    newsMediaRemoved?: number;        // ニュースメディア固有パターン削除数
    ecSiteRemoved?: number;           // EC・通販固有パターン削除数
    qaSiteRemoved?: number;           // Q&A・知恵袋固有パターン削除数
    videoSiteRemoved?: number;        // 動画プラットフォーム固有パターン削除数
```

- [ ] **Step 3: TypeScriptビルドを確認**

Run: `npm run type-check`
Expected: エラーなし（オプショナルフィールドの追加のみのため既存コードへの影響なし）

- [ ] **Step 4: Commit**

```bash
git add src/utils/aiSummaryCleaner/types.ts
git commit -m "feat(ai-summary-cleaning): Category B の型定義を追加"
```

---

## Task 7: index.ts（cleanseAISummaryContent）に配線

**Files:**
- Modify: `src/utils/aiSummaryCleaner/index.ts`
- Test: `src/utils/aiSummaryCleaner/__tests__/index.test.ts`（存在する場合。無ければこのタスクでは新規作成しない — Task 8 の統合テストで確認する）

- [ ] **Step 1: import 文に4関数を追加**

`src/utils/aiSummaryCleaner/index.ts` の `stripExtended.js` からの import ブロックに追加する。

```typescript
import {
    stripFixedElements,
    stripRecommendSections,
    stripPaginationElements,
    stripSnsPromoElements,
    stripPopupElements,
    stripPlatformNoise,
    stripTextDensityElements,
    stripShortSequenceElements,
    stripSymbolLineElements,
    stripLinkOnlyParagraphs,
    stripEnhancedHiddenElements,
    stripEmptyElements,
    stripJPLayoutPatterns,
    stripJPNavigationPatterns,
    stripAuthorMetaElements,
    stripAffiliateElements,
    stripSpeechBubbles,
    stripNewsMediaPatterns,
    stripEcSitePatterns,
    stripQaSitePatterns,
    stripVideoSitePatterns,
} from './stripExtended.js';
```

- [ ] **Step 2: オプション分割代入に4オプションを追加**

`cleanseAISummaryContent` 関数内の分割代入（`speechBubbleEnabled = false,` の行）の直後に追加する。

```typescript
        // Category B: Site-Type Specific Patterns (News/EC/QA/Video)
        newsMediaEnabled = false,
        ecSiteEnabled = false,
        qaSiteEnabled = false,
        videoSiteEnabled = false,
```

- [ ] **Step 3: カウンタ変数を追加**

`let speechBubbleRemoved = 0;` の行の直後に追加する。

```typescript
    let newsMediaRemoved = 0;
    let ecSiteRemoved = 0;
    let qaSiteRemoved = 0;
    let videoSiteRemoved = 0;
```

- [ ] **Step 4: strip呼び出しを追加**

`if (speechBubbleEnabled) { speechBubbleRemoved = stripSpeechBubbles(element); }` の行の直後に追加する。

```typescript
    // Category B: Site-Type Specific Patterns (News/EC/QA/Video)
    if (newsMediaEnabled) {
        newsMediaRemoved = stripNewsMediaPatterns(element);
    }

    if (ecSiteEnabled) {
        ecSiteRemoved = stripEcSitePatterns(element);
    }

    if (qaSiteEnabled) {
        qaSiteRemoved = stripQaSitePatterns(element);
    }

    if (videoSiteEnabled) {
        videoSiteRemoved = stripVideoSitePatterns(element);
    }
```

- [ ] **Step 5: total 集計式に4カウンタを追加**

`const total = ...` の式の末尾（`affiliateRemoved + speechBubbleRemoved;`）を以下に変更する。

```typescript
    const total = altRemoved + metadataRemoved + adsRemoved + navRemoved +
        socialRemoved + deepRemoved + jsonLdRemoved + lazyLoadRemoved +
        skipLinkRemoved + cardRemoved + linkDensityRemoved +
        fixedRemoved + recommendRemoved + paginationRemoved +
        snsPromoRemoved + popupRemoved + platformRemoved +
        textDensityRemoved + shortSeqRemoved + symbolLineRemoved +
        linkParaRemoved + enhancedHiddenRemoved + emptyElemRemoved +
        jpLayoutRemoved + jpNavigationRemoved + authorRemoved +
        affiliateRemoved + speechBubbleRemoved +
        newsMediaRemoved + ecSiteRemoved + qaSiteRemoved + videoSiteRemoved;
```

- [ ] **Step 6: logDebug の breakdown オブジェクトに4フィールドを追加**

`breakdown: { ... }` オブジェクト内の `speechBubble: speechBubbleRemoved,` の行の直後に追加する。

```typescript
            newsMedia: newsMediaRemoved,
            ecSite: ecSiteRemoved,
            qaSite: qaSiteRemoved,
            videoSite: videoSiteRemoved,
```

- [ ] **Step 7: 戻り値オブジェクトに4フィールドを追加**

`return { ... }` オブジェクト内の `speechBubbleRemoved,` の行の直後に追加する。

```typescript
        newsMediaRemoved,
        ecSiteRemoved,
        qaSiteRemoved,
        videoSiteRemoved,
```

- [ ] **Step 8: 統合テストを書く**

`src/utils/aiSummaryCleaner/__tests__/index.test.ts` が存在するか確認する。

Run: `ls src/utils/aiSummaryCleaner/__tests__/index.test.ts`

存在する場合はそのファイルに、存在しない場合は `src/utils/aiSummaryCleaner/__tests__/stripCore.test.ts` 冒頭の import パターンを参考に、以下のテストを追加する。

```typescript
describe('cleanseAISummaryContent — Category B integration', () => {
  it('applies newsMediaEnabled when true', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="byline-source">配信：共同通信</div><p>Article body content here for scoring.</p>';
    const result = cleanseAISummaryContent(root, { newsMediaEnabled: true, altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false, recommendEnabled: false, popupEnabled: false });
    expect(result.newsMediaRemoved).toBe(1);
  });

  it('does not apply newsMediaEnabled when false (default)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div class="byline-source">配信：共同通信</div><p>Article body content here for scoring.</p>';
    const result = cleanseAISummaryContent(root, { altEnabled: false, metadataEnabled: false, adsEnabled: false, navEnabled: false, socialEnabled: false, recommendEnabled: false, popupEnabled: false });
    expect(result.newsMediaRemoved).toBe(0);
  });
});
```

- [ ] **Step 9: テストを実行**

Run: `npx jest src/utils/aiSummaryCleaner/__tests__/index.test.ts -t "Category B integration"`
Expected: PASS（2件）

- [ ] **Step 10: Commit**

```bash
git add src/utils/aiSummaryCleaner/index.ts src/utils/aiSummaryCleaner/__tests__/
git commit -m "feat(ai-summary-cleaning): cleanseAISummaryContent に Category B オプションを配線"
```

---

## Task 8: StorageKeys と DEFAULT_SETTINGS に4キーを追加

**Files:**
- Modify: `src/utils/storage/types.ts`
- Modify: `src/utils/storage/defaults.ts`
- Test: `src/utils/__tests__/storage-keys.test.ts`

- [ ] **Step 1: StorageKeys に4キーを追加**

`src/utils/storage/types.ts` の `AI_SUMMARY_CLEANSING_SPEECH_BUBBLE: 'ai_summary_cleansing_speech_bubble', // 吹き出し要素クレンジング（デフォルト: false）` の行の直後に追加する。

```typescript
    // Category B: Site-Type Specific Patterns (News/EC/QA/Video)
    AI_SUMMARY_CLEANSING_NEWS_MEDIA: 'ai_summary_cleansing_news_media', // ニュースメディア固有パターン（デフォルト: true、新規ユーザーのみ）
    AI_SUMMARY_CLEANSING_EC_SITE: 'ai_summary_cleansing_ec_site', // EC・通販固有パターン（デフォルト: true、新規ユーザーのみ）
    AI_SUMMARY_CLEANSING_QA_SITE: 'ai_summary_cleansing_qa_site', // Q&A・知恵袋固有パターン（デフォルト: true、新規ユーザーのみ）
    AI_SUMMARY_CLEANSING_VIDEO_SITE: 'ai_summary_cleansing_video_site', // 動画プラットフォーム固有パターン（デフォルト: true、新規ユーザーのみ）
```

さらに、マイグレーション完了フラグを既存の `MIGRATION_JP_LAYOUT_DEFAULT_DONE: 'migration_jp_layout_default_done', // Category A jpLayout デフォルト移行完了フラグ` の行の直後に追加する。

```typescript
    MIGRATION_CATEGORY_B_DEFAULT_DONE: 'migration_category_b_default_done', // Category B デフォルト移行完了フラグ
```

- [ ] **Step 2: StorageKeyValues に4+1キーの型を追加**

`src/utils/storage/types.ts` の `[StorageKeys.AI_SUMMARY_CLEANSING_SPEECH_BUBBLE]: boolean;` の行の直後に追加する。

```typescript
    [StorageKeys.AI_SUMMARY_CLEANSING_NEWS_MEDIA]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_EC_SITE]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_QA_SITE]: boolean;
    [StorageKeys.AI_SUMMARY_CLEANSING_VIDEO_SITE]: boolean;
```

`[StorageKeys.MIGRATION_JP_LAYOUT_DEFAULT_DONE]: boolean;` の行の直後に追加する。

```typescript
    [StorageKeys.MIGRATION_CATEGORY_B_DEFAULT_DONE]: boolean;
```

- [ ] **Step 3: DEFAULT_SETTINGS に4キーを追加**

`src/utils/storage/defaults.ts` の `[StorageKeys.AI_SUMMARY_CLEANSING_SPEECH_BUBBLE]: false,` の行の直後に追加する。

```typescript
    // Category B: Site-Type Specific Patterns — default true for new users (existing users migrated to false)
    [StorageKeys.AI_SUMMARY_CLEANSING_NEWS_MEDIA]: true,
    [StorageKeys.AI_SUMMARY_CLEANSING_EC_SITE]: true,
    [StorageKeys.AI_SUMMARY_CLEANSING_QA_SITE]: true,
    [StorageKeys.AI_SUMMARY_CLEANSING_VIDEO_SITE]: true,
```

- [ ] **Step 4: 既存のstorage-keysテストを実行して既存パターンとの整合を確認**

Run: `npx jest src/utils/__tests__/storage-keys.test.ts`
Expected: PASS（既存テストが通ることを確認。新規キー追加によるテスト破壊がないことを確認）

- [ ] **Step 5: TypeScriptビルドを確認**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 6: Commit**

```bash
git add src/utils/storage/types.ts src/utils/storage/defaults.ts
git commit -m "feat(ai-summary-cleaning): Category B の StorageKeys とデフォルト値を追加"
```

---

## Task 9: migration.ts に既存ユーザー向け移行処理を追加

**Files:**
- Modify: `src/utils/migration.ts`

- [ ] **Step 1: migrateCategoryBDefault 関数を追加**

`src/utils/migration.ts` の `migrateJpLayoutDefault` 関数の直後に、同じロジック構造で以下を追加する。

```typescript
/**
 * Category B デフォルト移行
 * 既存ユーザー（すでにインストール済み）には newsMediaEnabled 等4フラグを明示的に false に設定し、
 * 挙動が突然変わるのを防ぐ。新規ユーザーは DEFAULT_SETTINGS から true を取得する。
 * @returns 移行が実行された場合は true
 */
export async function migrateCategoryBDefault(): Promise<boolean> {
  const MIGRATION_DONE_KEY = 'migration_category_b_default_done';
  const CATEGORY_B_KEYS = [
    'ai_summary_cleansing_news_media',
    'ai_summary_cleansing_ec_site',
    'ai_summary_cleansing_qa_site',
    'ai_summary_cleansing_video_site',
  ];

  const result = await chrome.storage.local.get([MIGRATION_DONE_KEY, ...CATEGORY_B_KEYS]);

  // Already migrated — nothing to do
  if (result[MIGRATION_DONE_KEY]) {
    return false;
  }

  const hasExistingCategoryBSetting = CATEGORY_B_KEYS.some(k => result[k] !== undefined);

  if (!hasExistingCategoryBSetting) {
    // No prior Category B setting — distinguish new install from existing user
    // by checking if any OTHER setting keys exist in storage (indicating prior use)
    const allKeys = await chrome.storage.local.get(null);
    const hasAnyExistingSetting = Object.keys(allKeys).some(k =>
      k !== MIGRATION_DONE_KEY && !CATEGORY_B_KEYS.includes(k)
    );

    if (hasAnyExistingSetting) {
      // Existing user who never touched Category B → preserve old behavior (false)
      const falseSettings = Object.fromEntries(CATEGORY_B_KEYS.map(k => [k, false]));
      await chrome.storage.local.set(falseSettings);
      console.log('[Migration] Category B default: existing user → set to false');
    }
    // Else: fresh install with no storage yet → leave alone, DEFAULT_SETTINGS (true) applies
  }
  // Else: user already set Category B explicitly → respect their choice, don't overwrite

  // Mark migration as done
  await chrome.storage.local.set({ [MIGRATION_DONE_KEY]: true });

  return true;
}
```

- [ ] **Step 2: migrateJpLayoutDefault の呼び出し元を確認し、同じ場所に migrateCategoryBDefault の呼び出しを追加**

Run: `grep -rn "migrateJpLayoutDefault" src/ --include="*.ts" -l`

呼び出し元ファイル（service-workerの初期化処理等）を開き、`await migrateJpLayoutDefault();` の直後に以下を追加する。

```typescript
    await migrateCategoryBDefault();
```

呼び出し元ファイルで `migrateJpLayoutDefault` がimportされている箇所も確認し、同様に `migrateCategoryBDefault` をimportに追加する。

- [ ] **Step 3: TypeScriptビルドを確認**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 4: 手動確認スクリプトでロジックを検証**

migration.ts に既存の `migrateJpLayoutDefault` 用テストファイルがあるか確認する。

Run: `find src -iname "*migration*test*"`

既存テストファイルがあれば、そのファイルの `migrateJpLayoutDefault` のテストケース構造を踏襲して `migrateCategoryBDefault` のテスト（新規インストール時はfalseを書き込まない、既存ユーザーはfalseを書き込む、既に移行済みなら何もしない、の3パターン）を追加する。テストファイルが無ければこのステップはスキップし、Task 10 のE2E確認で動作検証する。

- [ ] **Step 5: Commit**

```bash
git add src/utils/migration.ts
git commit -m "feat(ai-summary-cleaning): Category B の既存ユーザー向け移行処理を追加"
```

---

## Task 10: content script（extractor.ts）への配線

**Files:**
- Modify: `src/content/extractor.ts`

- [ ] **Step 1: フラグ変数を追加**

`src/content/extractor.ts` の `let aiSummaryCleansingSpeechBubble = false;` の行の直後に追加する。

```typescript
// Category B: Site-Type Specific Patterns (News/EC/QA/Video)
let aiSummaryCleansingNewsMedia = true;
let aiSummaryCleansingEcSite = true;
let aiSummaryCleansingQaSite = true;
let aiSummaryCleansingVideoSite = true;
```

- [ ] **Step 2: 設定読み込み処理を確認し、4フラグの読み込みを追加**

Run: `grep -n "aiSummaryCleansingSpeechBubble\s*=" src/content/extractor.ts`

このコマンドの出力箇所（`chrome.storage.local.get` の結果を各変数に代入している処理）に、以下と同様の代入を追加する（実際のキー名・代入パターンは grep の出力に合わせる）。

```typescript
        aiSummaryCleansingNewsMedia = settings[StorageKeys.AI_SUMMARY_CLEANSING_NEWS_MEDIA] ?? true;
        aiSummaryCleansingEcSite = settings[StorageKeys.AI_SUMMARY_CLEANSING_EC_SITE] ?? true;
        aiSummaryCleansingQaSite = settings[StorageKeys.AI_SUMMARY_CLEANSING_QA_SITE] ?? true;
        aiSummaryCleansingVideoSite = settings[StorageKeys.AI_SUMMARY_CLEANSING_VIDEO_SITE] ?? true;
```

- [ ] **Step 3: extractMainContent への引数渡し処理を確認し、4オプションを追加**

Run: `grep -n "speechBubbleEnabled:" src/content/extractor.ts`

出力箇所（`extractMainContent` 呼び出し時の `aiSummaryCleanseOptions` オブジェクト構築部分）に追加する。

```typescript
            newsMediaEnabled: aiSummaryCleansingNewsMedia,
            ecSiteEnabled: aiSummaryCleansingEcSite,
            qaSiteEnabled: aiSummaryCleansingQaSite,
            videoSiteEnabled: aiSummaryCleansingVideoSite,
```

- [ ] **Step 4: TypeScriptビルドを確認**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 5: Commit**

```bash
git add src/content/extractor.ts
git commit -m "feat(ai-summary-cleaning): content script に Category B フラグを配線"
```

---

## Task 11: contentExtractor/index.ts への配線

**Files:**
- Modify: `src/utils/contentExtractor/index.ts`

- [ ] **Step 1: extractMainContent 関数のオプション分割代入に4オプションを追加**

`src/utils/contentExtractor/index.ts` の `const { aiSummaryCleanseEnabled = false, ..., speechBubbleEnabled = false, ... } = aiSummaryCleanseOptions;` という1行にまとまった分割代入の末尾（`customPatterns = []` の直前）に追加する。

```typescript
newsMediaEnabled = false, ecSiteEnabled = false, qaSiteEnabled = false, videoSiteEnabled = false,
```

- [ ] **Step 2: cleanseAISummaryContent への引数渡し処理を確認し、4オプションを追加**

Run: `grep -n "speechBubbleEnabled," src/utils/contentExtractor/index.ts`

出力箇所（`cleanseAISummaryContent(clone, { ... })` の呼び出し引数オブジェクト、複数箇所ある場合がある）それぞれに追加する。

```typescript
                        newsMediaEnabled,
                        ecSiteEnabled,
                        qaSiteEnabled,
                        videoSiteEnabled,
```

- [ ] **Step 3: TypeScriptビルドを確認**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
git add src/utils/contentExtractor/index.ts
git commit -m "feat(ai-summary-cleaning): contentExtractor に Category B オプションを配線"
```

---

## Task 12: popup設定UI（aiSummaryCleansingSettingsV2.ts）に4チェックボックスを追加

**Files:**
- Modify: `src/popup/aiSummaryCleansingSettingsV2.ts`

- [ ] **Step 1: AiSummaryCleansingSettings interface に4フィールドを追加**

`src/popup/aiSummaryCleansingSettingsV2.ts` の `speechBubbleEnabled: boolean;   // 吹き出し要素クレンジング（デフォルト: false）` の行の直後に追加する。

```typescript
    // Category B: Site-Type Specific Patterns (News/EC/QA/Video)
    newsMediaEnabled: boolean;      // ニュースメディア固有パターン（デフォルト: true）
    ecSiteEnabled: boolean;         // EC・通販固有パターン（デフォルト: true）
    qaSiteEnabled: boolean;         // Q&A・知恵袋固有パターン（デフォルト: true）
    videoSiteEnabled: boolean;      // 動画プラットフォーム固有パターン（デフォルト: true）
```

- [ ] **Step 2: getAiSummaryCleansingSettings に4フィールドの取得処理を追加**

`speechBubbleEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_SPEECH_BUBBLE] ?? false,` の行の直後に追加する。

```typescript
        newsMediaEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_NEWS_MEDIA] ?? true,
        ecSiteEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_EC_SITE] ?? true,
        qaSiteEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_QA_SITE] ?? true,
        videoSiteEnabled: settings[StorageKeys.AI_SUMMARY_CLEANSING_VIDEO_SITE] ?? true,
```

- [ ] **Step 3: saveAiSummaryCleansingSettings への書き込み処理を確認し、4フィールドを追加**

Run: `grep -n "AI_SUMMARY_CLEANSING_SPEECH_BUBBLE\] = settings" src/popup/aiSummaryCleansingSettingsV2.ts`

出力箇所（`currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_SPEECH_BUBBLE] = settings.speechBubbleEnabled;` の行）の直後に追加する。

```typescript
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_NEWS_MEDIA] = settings.newsMediaEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_EC_SITE] = settings.ecSiteEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_QA_SITE] = settings.qaSiteEnabled;
    currentSettings[StorageKeys.AI_SUMMARY_CLEANSING_VIDEO_SITE] = settings.videoSiteEnabled;
```

- [ ] **Step 4: DOM要素取得処理に4チェックボックスの取得を追加**

Run: `grep -n "getElementById('ai-summary-cleansing-speech-bubble')" src/popup/aiSummaryCleansingSettingsV2.ts`

この grep は複数箇所ヒットする（DOM要素取得の関数が複数存在するため）。各ヒット箇所の直後に、対応するパターンで以下を追加する。

```typescript
    const newsMediaCheckbox = document.getElementById('ai-summary-cleansing-news-media') as HTMLInputElement;
    const ecSiteCheckbox = document.getElementById('ai-summary-cleansing-ec-site') as HTMLInputElement;
    const qaSiteCheckbox = document.getElementById('ai-summary-cleansing-qa-site') as HTMLInputElement;
    const videoSiteCheckbox = document.getElementById('ai-summary-cleansing-video-site') as HTMLInputElement;
```

- [ ] **Step 5: チェックボックス状態の反映処理（読み込み時）を追加**

Run: `grep -n "speechBubbleCheckbox.checked = settings.speechBubbleEnabled" src/popup/aiSummaryCleansingSettingsV2.ts`

出力箇所の直後に追加する。

```typescript
    if (newsMediaCheckbox) newsMediaCheckbox.checked = settings.newsMediaEnabled;
    if (ecSiteCheckbox) ecSiteCheckbox.checked = settings.ecSiteEnabled;
    if (qaSiteCheckbox) qaSiteCheckbox.checked = settings.qaSiteEnabled;
    if (videoSiteCheckbox) videoSiteCheckbox.checked = settings.videoSiteEnabled;
```

- [ ] **Step 6: フォーム送信時の値取得処理を追加**

Run: `grep -n "speechBubbleEnabled: (document.getElementById" src/popup/aiSummaryCleansingSettingsV2.ts`

出力箇所の直後に追加する。

```typescript
        newsMediaEnabled: (document.getElementById('ai-summary-cleansing-news-media') as HTMLInputElement)?.checked ?? true,
        ecSiteEnabled: (document.getElementById('ai-summary-cleansing-ec-site') as HTMLInputElement)?.checked ?? true,
        qaSiteEnabled: (document.getElementById('ai-summary-cleansing-qa-site') as HTMLInputElement)?.checked ?? true,
        videoSiteEnabled: (document.getElementById('ai-summary-cleansing-video-site') as HTMLInputElement)?.checked ?? true,
```

- [ ] **Step 7: 有効/無効切り替え（disabled制御）処理を追加**

Run: `grep -n "speechBubbleCheckbox.disabled = !enabled" src/popup/aiSummaryCleansingSettingsV2.ts`

出力箇所の直前・直後にある同種のDOM要素取得・disabled設定と同じパターンで追加する。

```typescript
    const newsMediaCheckbox = document.getElementById('ai-summary-cleansing-news-media') as HTMLInputElement;
    const ecSiteCheckbox = document.getElementById('ai-summary-cleansing-ec-site') as HTMLInputElement;
    const qaSiteCheckbox = document.getElementById('ai-summary-cleansing-qa-site') as HTMLInputElement;
    const videoSiteCheckbox = document.getElementById('ai-summary-cleansing-video-site') as HTMLInputElement;
```

```typescript
    if (newsMediaCheckbox) newsMediaCheckbox.disabled = !enabled;
    if (ecSiteCheckbox) ecSiteCheckbox.disabled = !enabled;
    if (qaSiteCheckbox) qaSiteCheckbox.disabled = !enabled;
    if (videoSiteCheckbox) videoSiteCheckbox.disabled = !enabled;
```

- [ ] **Step 8: チェックボックスIDリスト（一括操作用配列）があれば4つ追加**

`'ai-summary-cleansing-affiliate',` を含む配列（468行目付近）を確認する。

Run: `grep -n -A 20 "'ai-summary-cleansing-affiliate'," src/popup/aiSummaryCleansingSettingsV2.ts`

この配列に以下の4行を追加する。

```typescript
        'ai-summary-cleansing-news-media',
        'ai-summary-cleansing-ec-site',
        'ai-summary-cleansing-qa-site',
        'ai-summary-cleansing-video-site',
```

- [ ] **Step 9: TypeScriptビルドを確認**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 10: Commit**

```bash
git add src/popup/aiSummaryCleansingSettingsV2.ts
git commit -m "feat(ai-summary-cleaning): popup設定UIロジックに Category B オプションを追加"
```

---

## Task 13: 設定画面HTML（options/index.html）に4チェックボックスを追加

**Files:**
- Modify: `entrypoints/options/index.html`

- [ ] **Step 1: 既存の jp-layout チェックボックスHTML構造を確認**

Run: `grep -n -B 2 -A 3 "ai-summary-cleansing-jp-layout" entrypoints/options/index.html`

出力されたHTML構造（`<input>` + `<label>` の組）をテンプレートとして使う。

- [ ] **Step 2: speech-bubble チェックボックスの直後に4チェックボックスを追加**

Run: `grep -n -A 3 "ai-summary-cleansing-speech-bubble" entrypoints/options/index.html`

この出力箇所の直後に、Step 1 で確認した構造と同じ形式で以下を追加する。

```html
            <input type="checkbox" id="ai-summary-cleansing-news-media">
            <label for="ai-summary-cleansing-news-media" class="inline-label" data-i18n="aiSummaryCleansingNewsMediaDesc">ニュースメディア固有パターン（コメント欄・関連記事カード・記者クレジット等）。</label>
            <input type="checkbox" id="ai-summary-cleansing-ec-site">
            <label for="ai-summary-cleansing-ec-site" class="inline-label" data-i18n="aiSummaryCleansingEcSiteDesc">EC・通販固有パターン（レビュー・バリエーション選択・関連購入等）。</label>
            <input type="checkbox" id="ai-summary-cleansing-qa-site">
            <label for="ai-summary-cleansing-qa-site" class="inline-label" data-i18n="aiSummaryCleansingQaSiteDesc">Q&A・知恵袋固有パターン（ベストアンサー・関連質問・回答者情報等）。</label>
            <input type="checkbox" id="ai-summary-cleansing-video-site">
            <label for="ai-summary-cleansing-video-site" class="inline-label" data-i18n="aiSummaryCleansingVideoSiteDesc">動画プラットフォーム固有パターン（コメント弾幕・タグクラウド・関連動画等）。</label>
```

実際のHTML構造（ラップする`<div>`要素の有無等）は Step 1 で確認した既存パターンに正確に合わせること。

- [ ] **Step 3: Commit**

```bash
git add entrypoints/options/index.html
git commit -m "feat(ai-summary-cleaning): 設定画面に Category B チェックボックスを追加"
```

---

## Task 14: i18nメッセージの追加

**Files:**
- Modify: `public/_locales/ja/messages.json`
- Modify: `public/_locales/en/messages.json`

- [ ] **Step 1: 日本語メッセージを追加**

Run: `grep -n -A 3 "aiSummaryCleansingSpeechBubbleDesc" public/_locales/ja/messages.json`

出力箇所の直後（同じインデントレベル）に以下を追加する。既存の `aiSummaryCleansingJpLayoutDesc` エントリと同じJSON構造（`"message"` キーを持つオブジェクト）に従うこと。

```json
  "aiSummaryCleansingNewsMediaDesc": {
    "message": "ニュースメディア固有パターン（コメント欄・関連記事カード・記者クレジット等）。"
  },
  "aiSummaryCleansingEcSiteDesc": {
    "message": "EC・通販固有パターン（レビュー・バリエーション選択・関連購入等）。"
  },
  "aiSummaryCleansingQaSiteDesc": {
    "message": "Q&A・知恵袋固有パターン（ベストアンサー・関連質問・回答者情報等）。"
  },
  "aiSummaryCleansingVideoSiteDesc": {
    "message": "動画プラットフォーム固有パターン（コメント弾幕・タグクラウド・関連動画等）。"
  },
```

- [ ] **Step 2: 英語メッセージを追加**

Run: `grep -n -A 3 "aiSummaryCleansingSpeechBubbleDesc" public/_locales/en/messages.json`

出力箇所の直後に追加する。

```json
  "aiSummaryCleansingNewsMediaDesc": {
    "message": "News media specific patterns (comment sections, related article cards, byline credits, etc.)."
  },
  "aiSummaryCleansingEcSiteDesc": {
    "message": "E-commerce specific patterns (reviews, variation selectors, frequently bought together, etc.)."
  },
  "aiSummaryCleansingQaSiteDesc": {
    "message": "Q&A site specific patterns (best answer badges, related questions, answerer profiles, etc.)."
  },
  "aiSummaryCleansingVideoSiteDesc": {
    "message": "Video platform specific patterns (comment overlays, tag clouds, related videos, etc.)."
  },
```

- [ ] **Step 3: JSON構文が正しいことを確認**

Run: `node -e "JSON.parse(require('fs').readFileSync('public/_locales/ja/messages.json', 'utf8')); console.log('OK')"`
Expected: `OK`

Run: `node -e "JSON.parse(require('fs').readFileSync('public/_locales/en/messages.json', 'utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add public/_locales/ja/messages.json public/_locales/en/messages.json
git commit -m "feat(ai-summary-cleaning): Category B の i18n メッセージを追加"
```

---

## Task 15: 全体テスト実行とビルド確認

**Files:** なし（検証のみ）

- [ ] **Step 1: 型チェックを実行**

Run: `npm run type-check`
Expected: エラーなし

- [ ] **Step 2: 全テストスイートを実行**

Run: `npm test`
Expected: 全テストPASS（既存テストの回帰がないこと、Task 2〜7で追加したテストが含まれること）

- [ ] **Step 3: ビルドを実行**

Run: `npm run build`
Expected: `dist/chromium-mv3` にビルド成果物が生成され、エラーなし

- [ ] **Step 4: manifest.test.ts を実行（web_accessible_resources整合性確認）**

Run: `npx jest src/__tests__/manifest.test.ts`
Expected: PASS（今回の変更はファイル分割を伴わないため、web_accessible_resources の更新は不要）

- [ ] **Step 5: CHANGELOG.md にエントリを追加**

`CHANGELOG.md` の最新バージョンエントリの直前（または次期バージョン用のUnreleasedセクション）に、以下の内容を追記する。

```markdown
### Added
- AI要約クレンジングにCategory B（ニュース・EC・Q&A・動画プラットフォーム向けパターン）を追加
```

- [ ] **Step 6: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG に Category B 追加を記録"
```

---

## Self-Review Notes

- **Spec coverage:** B-1〜B-4の4パターン配列、4strip関数、types/index/storage/migration/extractor/popup/HTML/i18nへの配線、既存パターンとの非重複陰性テストを全てタスク化した。`countTargets.ts` は設計書で明示的にスコープ外としたため、本計画でも対象外。
- **Placeholder scan:** 全ステップに具体的なコード・grep コマンド・期待される出力を記載。「適切に」「後で」等の曖昧表現なし。
- **Type consistency:** `newsMediaEnabled` / `ecSiteEnabled` / `qaSiteEnabled` / `videoSiteEnabled`（オプション名）と `newsMediaRemoved` / `ecSiteRemoved` / `qaSiteRemoved` / `videoSiteRemoved`（結果フィールド名）を Task 6〜12 で一貫して使用している。
