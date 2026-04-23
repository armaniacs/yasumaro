# Plan C: Readabilityスコアによる本文保護

## 問題

AI要約クレンジングは「怪しい要素を削除する」方向で動作している。
しかし現状のパターンマッチングでは、記事本文と思われる要素が誤って削除される。

Readabilityスコアを導入することで、「本文と判定した要素は削除しない」という保護の仕組みを作る。

## Readabilityスコアとは

Mozillaが開発したアルゴリズムで、Firefoxのリーダーモードに使用されている。
各DOM要素に対して「本文らしさ」をスコアリングし、高スコア要素を本文と見なす。

**スコアの加算要素:**
- テキスト量が多い（文字数）
- `<p>` タグを多く含む
- class/id名が "content", "article", "body", "text", "post" 等
- リンクの割合が低い（テキスト密度が高い）
- 見出し（`<h1>`〜`<h6>`）を含む

**スコアの減算要素:**
- class/id名が "nav", "menu", "sidebar", "footer", "comment", "ad" 等
- リンクの割合が高い（50%超）
- テキストがほとんどない

**既存コードとの関係:**
`src/utils/contentExtractor/scoring.ts` にすでに `calculateTextScore()` が存在する。
これを拡張してReadabilityスコアとして活用できる。

## 目標

AI要約クレンジング実行前に、**本文スコアが高い要素をマーキング**しておき、
クレンジング処理中はマーキングされた要素を削除しない（保護する）。

## 実装方針

### Step 1: Readabilityスコアの定義

**ファイル（新規）:** `src/utils/aiSummaryCleaner/readabilityScore.ts`

```typescript
// 本文らしさスコアを計算する
export function calculateReadabilityScore(element: Element): number {
    let score = 0;
    const text = element.textContent || '';

    // テキスト量（文字数）
    score += Math.min(text.length / 10, 300);

    // <p>タグの数（記事本文の主要マーカー）
    score += element.querySelectorAll('p').length * 25;

    // 見出しの存在
    score += element.querySelectorAll('h1,h2,h3,h4,h5,h6').length * 50;

    // class/id名によるスコア補正
    const identifier = `${element.className} ${element.id}`.toLowerCase();
    
    const positivePatterns = ['article', 'content', 'body', 'text', 'post', 'story', 'main', 'entry'];
    const negativePatterns = ['nav', 'menu', 'sidebar', 'footer', 'comment', 'ad', 'banner', 'widget'];
    
    for (const pat of positivePatterns) {
        if (identifier.includes(pat)) score += 50;
    }
    for (const pat of negativePatterns) {
        if (identifier.includes(pat)) score -= 50;
    }

    // リンク密度（高いとスコアを下げる）
    const links = element.querySelectorAll('a');
    const linkText = Array.from(links).reduce((sum, a) => sum + (a.textContent?.length ?? 0), 0);
    const linkRatio = text.length > 0 ? linkText / text.length : 0;
    if (linkRatio > 0.5) {
        score *= 0.5;
    }

    return score;
}
```

### Step 2: 本文候補要素のマーキング

**ファイル（新規）:** `src/utils/aiSummaryCleaner/bodyProtection.ts`

```typescript
const BODY_PROTECTION_ATTR = 'data-ow-body-protected';
const BODY_SCORE_THRESHOLD = 200;  // この値以上を本文と見なす

// クレンジング前: 本文スコアが高い要素に保護マーカーを付ける
export function markBodyElements(root: Element): void {
    const elements = root.querySelectorAll('p, div, section, article');
    for (const elem of elements) {
        const score = calculateReadabilityScore(elem);
        if (score >= BODY_SCORE_THRESHOLD) {
            elem.setAttribute(BODY_PROTECTION_ATTR, 'true');
        }
    }
}

// クレンジング後: マーカーを除去する（DOMのクリーンアップ）
export function unmarkBodyElements(root: Element): void {
    const marked = root.querySelectorAll(`[${BODY_PROTECTION_ATTR}]`);
    for (const elem of marked) {
        elem.removeAttribute(BODY_PROTECTION_ATTR);
    }
}

// 要素が保護されているか確認
export function isBodyProtected(element: Element): boolean {
    // 自身または祖先要素が保護されているかチェック
    return element.closest(`[${BODY_PROTECTION_ATTR}]`) !== null;
}
```

### Step 3: 各stripXxx関数に保護チェックを追加

**ファイル:** `src/utils/aiSummaryCleaner/helpers.ts`（または各stripファイル）

各 `stripXxx()` 関数で要素を削除する前に保護チェックを挿入:

```typescript
// helpers.ts に追加
import { isBodyProtected } from './bodyProtection.js';

export function safeRemoveElement(element: Element): boolean {
    if (isBodyProtected(element)) {
        return false;  // 本文保護: 削除しない
    }
    element.remove();
    return true;
}
```

各 `stripXxx()` 関数の `elem.remove()` を `safeRemoveElement(elem)` に置き換える。

### Step 4: クレンジングオーケストレーターに組み込む

**ファイル:** `src/utils/aiSummaryCleaner/index.ts`

```typescript
import { markBodyElements, unmarkBodyElements } from './bodyProtection.js';

export function cleanseAISummaryContent(root: Element, options: AiSummaryCleanseOptions): AiSummaryCleanseResult {
    // Step 1: 本文要素にマーキング
    markBodyElements(root);

    try {
        // Step 2: 既存のクレンジング処理（各stripXxxが保護チェック付きで動作）
        // ... 既存処理 ...
    } finally {
        // Step 3: マーカーを除去
        unmarkBodyElements(root);
    }

    return result;
}
```

### Step 5: オプション化

ユーザーが保護機能を無効化できるようにする:

```typescript
// AiSummaryCleanseOptions に追加
bodyProtectionEnabled?: boolean;  // デフォルト: true
bodyProtectionThreshold?: number; // デフォルト: 200
```

## 対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/utils/aiSummaryCleaner/readabilityScore.ts` | 新規: スコア計算ロジック |
| `src/utils/aiSummaryCleaner/bodyProtection.ts` | 新規: マーキング/保護チェック |
| `src/utils/aiSummaryCleaner/helpers.ts` | `safeRemoveElement()` 追加 |
| `src/utils/aiSummaryCleaner/stripCore.ts` | 各strip関数に保護チェック（11箇所） |
| `src/utils/aiSummaryCleaner/stripExtended.ts` | 各strip関数に保護チェック（15箇所） |
| `src/utils/aiSummaryCleaner/index.ts` | マーキング処理をクレンジングフローに組み込む |
| `src/utils/aiSummaryCleaner/types.ts` | `AiSummaryCleanseOptions` に新オプション追加 |
| `src/utils/aiSummaryCleaner/__tests__/` | 新ファイルのテスト追加 |
| `manifest.json` | 新ファイル追加に伴う `web_accessible_resources` 更新 |

## スコア閾値の調整

`BODY_SCORE_THRESHOLD = 200` は暫定値。調整の指針:

| 閾値 | 効果 |
|-----|-----|
| 100 | 広く保護（ノイズも保護される可能性） |
| 200 | バランス（推奨スタート値） |
| 300 | 厳格に保護（長文のみ） |
| 500 | ほぼ保護なし |

実際のニュースサイトでテストしてキャリブレーションする。

## テストケース

| シナリオ | 期待動作 |
|---------|---------|
| 記事本文の`<p>`多数 → スコア高 | 削除されない |
| nav内の`<p>`少数 → スコア低 | 通常通り削除される |
| `.nav-content` 内の長文 → class減点あるが文字数多い | スコア次第（境界ケース） |
| `role="contentinfo"` の短文 | 削除される（保護スコア低い） |

## 既存コードとの関係

`src/utils/contentExtractor/scoring.ts` の `calculateTextScore()` は候補要素の選択に使う。
今回新規作成する `readabilityScore.ts` はクレンジング時の保護判定に使う。
役割が異なるため別ファイルとするが、将来的に統合も検討できる。

## 実装の難易度と注意点

- `stripCore.ts`（11関数）と `stripExtended.ts`（15関数）の計26箇所に保護チェックを追加する必要がある
- 各関数の削除カウント（`totalRemoved` 等）は保護された要素をカウントしない
- パフォーマンス: `querySelectorAll` を大量に呼ぶため、大きなDOMでは遅くなる可能性がある
  → 最初から `BODY_SCORE_THRESHOLD` を高めに設定してスキャン対象を絞る
- Plan A完了後に着手することを推奨（Plan Aがあれば最悪ケースはカバーできる）
