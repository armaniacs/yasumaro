# Yasumaro の AI 要約クレンジングはどう動いているか — ソースコードを 5 周して見つけた設計判断と潜在リスク

[日本語](#日本語) | [English](#english)

---

## 日本語

### ある日の違和感

ダッシュボードのクレンジング統計を見ていて、ふと気になりました。

「記録されたページのうち、AI要約クレンジングで要素が削除された割合がやけに高い。しかも、何が消えたかが 'alt' とか 'multiple' としか出てこない。これって本当に効いてるんだろうか。」

Yasumaro には 2 種類のクレンジングがあります。**Content Cleansing** は、閲覧履歴として記録する前にパスワードやクレジットカード情報を削除するもの。一方の **AI要約クレンジング（AI Summary Cleansing）**は、AI 要約を生成するときに送信する HTML から、広告・ナビ・メタデータといったノイズを取り除くものです。この記事で扱うのは後者です。

せっかくなので、ソースコードを端から端まで読み込んで、5 つの観点で深掘りしてみました。その結果、設計の巧みさと同時に、いくつかの「ここ大丈夫？」というポイントも見つかりました。

---

### 大前提: クレンジングは 2 段構え

Yasumaro のコンテンツ抽出パイプラインは、以下のような順番で動いています。

```
ページ取得 → Content Cleansing（センシティブ情報除去）
          → AI要約クレンジング（ノイズ除去）
          → AI要約生成 or Obsidian保存
```

Content Cleansing は元の DOM を直接書き換えますが、AI要約クレンジングは **DOM のクローン** に対して実行されます。つまり、元のページ表示には一切影響を与えません。この設計は安心できるポイントです。

ただ、面白いのは「どちらのクレンジングが有効か」の組み合わせです。ユーザー設定次第で、Content Cleansing だけ、AI要約クレンジングだけ、両方、の 3 通りがあります。実際のコードでは 3 つの分岐に分かれていて、それぞれほぼ同じオプション構築処理が繰り返されていました。この重複は、将来のメンテナンスで見落としが発生しやすい箇所です。

---

### 発見 1: クレンジングは 76 回の DOM 走査で構成される

すべてのオプションを ON にしたとき、AI要約クレンジングは 1 回の実行で **およそ 76 回の `querySelectorAll`** を呼び出します。

| カテゴリ | 関数数 | querySelectorAll 呼び出し数 |
|---------|-------|--------------------------|
| Core（11 関数） | 11 | 33 |
| Extended（6 関数） | 6 | 17 |
| Advanced（9 関数） | 9 | 16 |
| テーマ/サイト種別（6 関数） | 6 | 6 |
| 本文保護（mark/unmark） | 2 | 2 |
| **合計** | **34** | **~74** |

デフォルト設定（7 項目が ON）なら約 21 回で済みますが、それでも 21 回の `querySelectorAll` が同じ DOM ツリーに対して走るのは、決して軽くはありません。それぞれの関数が独立して「広告を探す」「ナビを探す」「メタデータを探す」と繰り返すからです。

例えば `buildClassIdSelectors()` というヘルパーは、パターン配列を受け取って `[class*="ad-"],[id*="ad-"]` のようなセレクター文字列を組み立てます。これ自体は巧い抽象化ですが、この結果を**関数ごとに毎回ゼロから構築している**のが気になりました。パターンは不変なので、初回だけ構築して使い回せば数ミリ秒単位の最適化になります。

---

### 発見 2: パターンマッチングは意図的に広い

実際に使われているパターンを見てみると、かなり攻めていることがわかります。

```typescript
// patterns.ts より抜粋
export const AD_CLASS_PATTERNS = [
    'ad-', 'advertisement', 'sponsor', 'sponsored',
    'promo', 'promotion', 'banner-ad', // ...
];

export const SOCIAL_CLASS_PATTERNS = [
    'facebook', 'twitter', 'x-', 'linkedin',
    'instagram', 'share', 'social', // ...
];
```

`ad-` は `admin` や `address` にもマッチします。`x-` はもはや Twitter とは無関係な CSS フレームワークのクラス名にもヒットします。`share` や `menu` のような短いパターンは、いたるところに存在します。

これに対して、Yasumaro は **本文保護（Body Protection）** という仕組みで対抗しています。クレンジングの前に各要素の「本文らしさスコア」を計算し、高いスコアの要素には削除禁止マーカーを付ける。クレンジング中に `safeRemoveElement()` が呼ばれるたびに `isBodyProtected()` でチェックされ、保護されている要素は削除されません。

つまり「パターンは広く取っておいて、削除する直前に『これは本文？』と確認する」という戦略です。このアプローチなら、新しいサイトに対してもある程度ロバストに動作します。一方で、クレンジングのたびに全要素のスコア計算 → 全削除候補の保護チェックと、2 段階の DOM 走査が発生するのはトレードオフです。

---

### 発見 3: 二重の安全弁と、その隙間

AI要約クレンジングには 2 つの安全機構があります。

**1. 本文保護（Body Protection）**

クレンジング前に全要素の可読性スコアを計算。「テキスト量」「p タグ数」「見出しの有無」「class/id 名（'article' や 'content' を含むと加点、'nav' や 'footer' を含むと減点）」「リンク密度」の 5 つの指標でスコアを算出し、200 以上の要素を保護します。

**2. 過剰削減フォールバック（Over-cleansed Fallback）**

クレンジング後にコンテンツが元の 20% 未満に減っていた場合、または絶対量が 300 バイト未満だった場合、クレンジング前のテキストに自動で戻します。さらに悪化して 100 文字未満の場合は、`document.body.innerText` 全体を使うフォールバックに切り替わります。

この二重の安全弁は良くできています。ただ、あえて挙げるとすれば、フォールバックの 20% という閾値は「ページのうち 80% 以上がノイズ」なサイト、つまり記事よりも周辺要素のほうが多いページでは、過剰に発動する可能性があります。そういうページは実際にクレンジングをかけたいページそのものなので、「安全側に倒す」という判断自体は正しいものの、クレンジングの効果が得られない場面が一部にある、という認識は必要です。

---

### 発見 4: デフォルト値が 4 箇所で微妙に違う

ここが今回の深掘りでもっとも気になったポイントです。AI要約クレンジングの各設定には「デフォルト値」を定義している場所が 4 箇所もあります。

| 定義場所 | ファイル |
|---------|---------|
| ① ストレージの初期値 | `src/utils/storage/defaults.ts` |
| ② ストレージのキー定義（コメント） | `src/utils/storage/types.ts` |
| ③ Content Script の初期変数 | `src/content/extractor.ts` |
| ④ クレンジング関数のデフォルト引数 | `src/utils/aiSummaryCleaner/index.ts` |

ほとんどの項目はこれらが一致していますが、いくつか食い違いがありました。

| 設定 | ① ストレージ初期値 | ③ Content Script | ④ 関数デフォルト |
|------|-----------------|-----------------|----------------|
| deepEnabled | **true** | false | false |
| linkDensityEnabled | **true** | false | false |
| jpLayoutEnabled | **true**（新規ユーザーのみ） | false | false |
| enhancedHiddenEnabled | false | false | **true**（コメント上） |
| emptyElemEnabled | false | false | **true**（コメント上） |

特に `deepEnabled` と `linkDensityEnabled` は、ストレージの初期値が `true` であるにもかかわらず、コメントも Content Script の初期値も `false` です。この結果、新規ユーザーだけが意図せず有効になっている可能性があります。「新規ユーザーのほうがノイズ除去に積極的でいい」という設計判断ならそれで構わないのですが、ドキュメントと実装が一致していないのは、あとで混乱を招きます。

```typescript
// defaults.ts より
[StorageKeys.AI_SUMMARY_CLEANSING_DEEP]: true,      // コメントには「デフォルト: false」
[StorageKeys.AI_SUMMARY_CLEANSING_LINK_DENSITY]: true, // コメントには「デフォルト: false」
```

このズレは、経緯を知らない開発者が「バグだ」と思って直してしまうリスクがあります。実際、私も最初は「ストレージのデフォルトが間違っている」と判断しかけました。

---

### 発見 5: bodyProtection のスコア計算はシンプルだが粗い

本文保護で使われている `calculateReadabilityScore()` は、たった 37 行の関数です。

```typescript
export function calculateReadabilityScore(element: Element): number {
    let score = 0;
    const text = element.textContent || '';
    score += Math.min(text.length / 10, 300);             // テキスト量
    score += element.querySelectorAll('p').length * 25;    // p タグ数
    score += element.querySelectorAll('h1,h2,h3,h4,h5,h6').length * 50; // 見出し
    // class/id 名による補正
    // リンク密度ペナルティ（50%超でスコア半減）
    return score;
}
```

閾値 200 を超えるには、8 個の p タグか、4 個の見出しか、2000 文字以上のテキストが必要です。一般的な記事本文は余裕でクリアしますが、短い記事やリスト中心のコンテンツでは保護されず、削除されるリスクがあります。

特に問題なのは、このスコア計算自体も `querySelectorAll` を呼ぶということ。bodyProtection のマーキング処理だけで 2 回の DOM 走査が発生し、その後に各 strip 関数がさらに走査を繰り返します。「二重の安全弁」は「二重の DOM 走査」でもある、というのが正直な印象です。

---

### 全体の設計を振り返って

| 層 | 処理 | 強み | 弱み |
|----|------|------|------|
| パターンマッチング | class/id ベースの広域検出 | カバレッジが広い | 誤検出が多い |
| 本文保護 | スコアベースの削除ガード | 記事本文を守れる | スコア計算が単純、短い記事に弱い |
| 過剰削減フォールバック | 量的な SafetyNet | 完全な誤削除を防止 | ノイズの多いサイトで無効化されがち |
| クローン実行 | DOM をコピーして処理 | 元のページに影響ゼロ | メモリ消費が 2 倍 |

コードを 5 周した結論として、このクレンジングシステムは「**実用的な堅牢さと、そこかしこの粗さ**」が混在している、というのが正直な感想です。

意図的に広く取ったパターン、それをカバーする二重の安全弁、そしてデフォルト値の揺れ——これらは Yasumaro が拡張機能であるという制約（ユーザーの環境で動く、DOM に直接アクセスできる、でも完璧なサイト適応は不可能）の中で取れる現実的なバランスなのだと思います。

---

### 開発者の方向け: すぐに効く改善案

1. **ストレージのデフォルト値とコメントを一致させる**。`deepEnabled` と `linkDensityEnabled` は、どちらかに統一しましょう。コードは true と false の差が 1 文字で、そのインパクトは大きいです。

2. **パターンリストの単体テストを書く**。特に `buildClassIdSelectors()` には「このパターンが何にマッチするか」のテストがあると安心です。`ad-` が `address` にマッチしないことの確認だけでも価値があります。

3. **querySelectorAll の回数を減らす「集約パス」を検討する**。全部の関数が独立して DOM を走るのではなく、「一度全部の候補を集めてから type ごとに仕分ける」方式にすれば、走査回数は 1/10 になります。

4. **フォールバックの閾値をユーザー設定可能にする**。20% という値はサイトによっては厳しすぎます。「クレンジングを強めにしたい」と思って設定を ON にしたのに、フォールバックで全部戻ってしまうのは本末転倒です。

#### 追記: 上記4件、実際に対応しました

この記事を書いたあと、4件とも実装に着手しました。着手前に既存コードを再確認したところ、記事の指摘の一部に誤りがあったので、それも含めて報告します。

1. **デフォルト値とコメントの不一致**: `deepEnabled` / `linkDensityEnabled` はコメント側を実装（`true`）に合わせて修正しました。一方、記事で指摘した `enhancedHiddenEnabled` / `emptyElemEnabled` は再調査の結果、実際にはコメントも `false` で実装と一致しており、記事の誤りでした（お詫びして訂正します）。`extractor.ts` のモジュール初期値（`let deepEnabled = false` 等）は「storage読み込み完了までの一時値」であり、storageのデフォルトと一致させる設計ではないため、その旨をコメントで明示しました。

2. **パターンリストの単体テスト**: 既存の `helpers.test.ts` には `isLikelyAd()` 等の誤検出防止テストが実はすでに多数あったため、パターン配列（`AD_CLASS_PATTERNS` 等）を `buildClassIdSelectors()` 経由で実際のDOM要素にマッチさせる統合的なテストを新規に追加しました。`address-book` のようなクラス名が `ad-` パターンに誤爆しないことなどを検証しています。

3. **querySelectorAll の集約パス**: 「全34関数を書き換えて1回のDOM走査に集約する」という全面リファクタは、実測データがない状態で着手するとリスクがリターンに見合わないと判断し、見送りました。代わりに `buildClassIdSelectors()` が返すセレクター文字列を、不変パターンに限ってモジュール読み込み時に一度だけ構築してキャッシュする、という小規模な改善に絞りました。`querySelectorAll` の呼び出し回数自体は変わりませんが、毎回の文字列組み立て・エスケープ処理の重複コストは解消されています（ユーザー設定で動的に変わるカスタムパターンを含む箇所はキャッシュ対象から除外）。

4. **フォールバック閾値の設定可能化**: `AI_SUMMARY_CLEANSING_FALLBACK_RATIO`（デフォルト20%）・`AI_SUMMARY_CLEANSING_FALLBACK_MIN_BYTES`（デフォルト300バイト）を新設し、ダッシュボードの「AI要約クレンジング」設定パネルにスライダーを追加しました。ノイズの多いサイトでクレンジング効果が打ち消されてしまう問題に対して、ユーザー自身が閾値を調整できるようになりました。

---

### ユーザーの方向け: 今日からできること

- ダッシュボードの「クレンジング統計」で、自分の設定で何がどれだけ削除されているか確認してみてください
- 「AI要約クレンジング」の設定画面で、本文保護（Body Protection）が ON になっていることを確認してください。これが一番の安全弁です
- 高度な設定（jpLayoutEnabled など）はデフォルト OFF です。WordPress 系のサイトをよく見るなら ON にしてみてもいいですが、最初は様子を見ながらがおすすめです

---

## English

### A Moment of Doubt

I was looking at the cleansing statistics on the dashboard, and something caught my attention.

"The percentage of pages where the AI summary cleansing removed elements seems unusually high. And all I can see is 'alt' or 'multiple' as the reason. Is this actually working?"

Yasumaro has two kinds of cleansing. **Content Cleansing** removes sensitive information like passwords and credit card numbers before saving to browsing history. **AI Summary Cleansing** removes noise — ads, navigation, metadata — from the HTML before sending it to the AI for summarization. This article is about the latter.

I decided to read through the entire source code and dig deep from five different angles. I found some elegant design decisions and a few "wait, is this right?" moments.

---

### The Big Picture: Two-Stage Cleansing

Yasumaro's content extraction pipeline runs in this order:

```
Page fetch → Content Cleansing (sensitive info removal)
           → AI Summary Cleansing (noise removal)
           → AI summarization or Obsidian save
```

Content Cleansing modifies the real DOM, but AI Summary Cleansing runs on a **DOM clone**. It never touches the actual page. That's a solid design choice.

What's interesting is the combinations. Depending on user settings, you can have "Content Cleansing only," "AI Summary Cleansing only," or "both." The actual code has three branches that each build nearly identical option objects. That repetition is a maintenance risk over time.

---

### Finding 1: 76 DOM Traversals Per Cleansing Run

With all options enabled, one AI Summary Cleansing run triggers roughly **76 `querySelectorAll` calls**.

| Category | Functions | querySelectorAll calls |
|----------|-----------|----------------------|
| Core (11) | 11 | 33 |
| Extended (6) | 6 | 17 |
| Advanced (9) | 9 | 16 |
| Theme/Site (6) | 6 | 6 |
| Body Protection (2) | 2 | 2 |
| **Total** | **34** | **~74** |

With default settings (7 toggles ON), it's about 21 calls. But even 21 `querySelectorAll` calls over the same DOM tree is not exactly lightweight. Each function independently searches for ads, navigation, metadata, and so on.

For example, the `buildClassIdSelectors()` helper assembles CSS selector strings like `[class*="ad-"],[id*="ad-"]` from pattern arrays. It's a neat abstraction, but it rebuilds those strings **from scratch every time**. Since the patterns are immutable, building them once and reusing would save a few milliseconds per run.

---

### Finding 2: Patterns Are Intentionally Broad

The actual patterns are quite aggressive:

```typescript
export const AD_CLASS_PATTERNS = [
    'ad-', 'advertisement', 'sponsor', // ...
];
export const SOCIAL_CLASS_PATTERNS = [
    'facebook', 'twitter', 'x-', 'share', // ...
];
```

`ad-` matches `admin` and `address`. `x-` matches CSS framework class names that have nothing to do with Twitter/X. Patterns like `share` and `menu` exist everywhere.

Yasumaro counters this with **Body Protection**. Before cleansing, it scores each element's "article-likeness." High-scoring elements get a no-delete marker. Every time `safeRemoveElement()` is called, it checks `isBodyProtected()`, skipping protected elements.

The strategy is "cast a wide net, then verify before deleting." This makes the system reasonably robust across different sites. The tradeoff is two passes over the DOM — one for scoring, one for cleansing — every single time.

---

### Finding 3: Two Safety Nets, and Their Gaps

There are two safety mechanisms in AI Summary Cleansing.

**1. Body Protection**

Before cleansing, every element gets a readability score based on five factors: text volume, `<p>` count, heading count, class/id hints (positive for 'article'/'content', negative for 'nav'/'footer'), and link density. Elements scoring 200+ are protected.

**2. Over-cleansed Fallback**

If cleansing reduces content to under 20% of the original, or the absolute size drops below 300 bytes, the system automatically reverts to the pre-cleansing text. If it gets worse (under 100 characters), it falls back to `document.body.innerText`.

This two-layer safety is well-designed. The one edge case: the 20% threshold may trigger too often on noise-heavy pages where 80%+ of the DOM is actually ads and widgets — exactly the pages that need cleansing most.

---

### Finding 4: Default Values Are Defined in 4 Places — and They Don't Always Match

This is the most concerning discovery. Default values for cleansing settings are defined in four separate locations:

| Location | File |
|----------|------|
| ① Storage defaults | `src/utils/storage/defaults.ts` |
| ② Storage key comments | `src/utils/storage/types.ts` |
| ③ Content script variables | `src/content/extractor.ts` |
| ④ Function parameter defaults | `src/utils/aiSummaryCleaner/index.ts` |

Most values are consistent. Some are not:

| Setting | ① Storage | ③ Content Script | ④ Function Default |
|---------|-----------|-----------------|-------------------|
| deepEnabled | **true** | false | false |
| linkDensityEnabled | **true** | false | false |
| jpLayoutEnabled | **true** (new users) | false | false |
| enhancedHiddenEnabled | false | false | **true** (in comment) |
| emptyElemEnabled | false | false | **true** (in comment) |

The storage defaults for `deepEnabled` and `linkDensityEnabled` are `true`, while every other layer says `false`. New users might have these features active without realizing it. If that's intentional — "new users benefit from more aggressive cleansing" — that's a valid choice. But the inconsistency between documentation and code will confuse future maintainers.

```typescript
// defaults.ts
[StorageKeys.AI_SUMMARY_CLEANSING_DEEP]: true,      // comment says "default: false"
[StorageKeys.AI_SUMMARY_CLEANSING_LINK_DENSITY]: true, // comment says "default: false"
```

This creates a real risk: a developer unfamiliar with the history will "fix" these to `false`, changing behavior for new users without realizing it.

---

### Finding 5: Body Protection Scoring Is Simple but Coarse

The `calculateReadabilityScore()` function is just 37 lines:

```typescript
export function calculateReadabilityScore(element: Element): number {
    let score = 0;
    const text = element.textContent || '';
    score += Math.min(text.length / 10, 300);             // text volume
    score += element.querySelectorAll('p').length * 25;    // <p> count
    score += element.querySelectorAll('h1,h2,h3,h4,h5,h6').length * 50; // headings
    // class/id hint bonus/penalty
    // link density penalty (50%+ halves the score)
    return score;
}
```

Hitting the 200 threshold requires 8 `<p>` tags, 4 headings, or 2000+ characters of text. Typical articles clear this easily, but short posts or list-heavy content may fall below the bar and lose protection.

The scoring itself calls `querySelectorAll` — adding two more DOM traversals on top of everything else. The "two safety nets" are also "two extra DOM passes."

---

### Architecture at a Glance

| Layer | What It Does | Strength | Weakness |
|-------|-------------|----------|----------|
| Pattern matching | Broad class/id-based detection | High coverage | High false positives |
| Body Protection | Score-based deletion guard | Protects article body | Simple scoring, weak on short content |
| Over-cleansed fallback | Quantitative safety net | Prevents total data loss | May neutralize cleansing on noisy pages |
| Clone-based execution | Operates on a DOM copy | Zero page impact | 2x memory per extraction |

After five rounds of code study, my honest take is that this cleansing system is a mix of **pragmatic robustness and scattered rough edges**. The intentionally broad patterns, the two-layer safety net, the drifting default values — they all reflect the reality of building a browser extension that must work everywhere without site-specific adaptation.

---

### For Developers: Quick Wins

1. **Align storage defaults with documentation**. `deepEnabled` and `linkDensityEnabled` are off by one character, but the impact is broad.

2. **Write unit tests for pattern matching**. Even a simple test verifying that `ad-` does not match `address` would prevent regressions.

3. **Consider a consolidated DOM pass**. Collect all candidates in one traversal, then sort by type, instead of 21+ independent `querySelectorAll` calls.

4. **Make fallback thresholds user-configurable**. 20% works for most sites, but users who explicitly enable more cleansing toggles might want tighter control.

#### Update: We Actually Fixed All Four

After writing this article, we went ahead and implemented all four items. Re-checking the code before starting turned up an error in one of the original findings, which we're correcting here too.

1. **Default value / comment mismatch**: We aligned the comments for `deepEnabled` / `linkDensityEnabled` with the actual implementation (`true`). However, `enhancedHiddenEnabled` / `emptyElemEnabled`, which the article originally flagged, turned out on re-inspection to already have matching comments and implementation (both `false`) — that part of the article was wrong, and we apologize for the error. We also added a comment to the module-level initial values in `extractor.ts` (e.g. `let deepEnabled = false`) clarifying that these are temporary placeholders until `chrome.storage` loads, and are not meant to match the storage defaults by design.

2. **Unit tests for pattern lists**: It turned out `helpers.test.ts` already had a fair number of false-positive-prevention tests for functions like `isLikelyAd()`. What was missing was an integration-style test that applies pattern arrays (e.g. `AD_CLASS_PATTERNS`) to real DOM elements via `buildClassIdSelectors()`. We added that, verifying for example that a class name like `address-book` doesn't false-positive against the `ad-` pattern.

3. **Consolidated querySelectorAll pass**: We decided against the full rewrite (restructuring all 34 functions into a single DOM traversal) — without measured performance data, the risk didn't seem to justify the payoff. Instead we made a smaller, targeted fix: caching the selector strings that `buildClassIdSelectors()` builds from immutable patterns, computed once at module load instead of rebuilt on every call. The number of `querySelectorAll` calls is unchanged, but the redundant string-building and escaping work is gone. Functions that use dynamic, user-configurable custom patterns were excluded from this caching.

4. **Configurable fallback thresholds**: We added `AI_SUMMARY_CLEANSING_FALLBACK_RATIO` (default 20%) and `AI_SUMMARY_CLEANSING_FALLBACK_MIN_BYTES` (default 300 bytes) as new settings, with sliders in the dashboard's AI Summary Cleansing panel. Users can now tune these thresholds themselves on noise-heavy sites where the fallback was neutralizing the cleansing effect.

---

### For Users: What You Can Do Today

- Check the "Cleansing Statistics" on your dashboard to see what's being removed and how much
- Make sure **Body Protection** is ON in your AI Summary Cleansing settings — it's your primary safety net
- Advanced options like `jpLayoutEnabled` are OFF by default. If you browse a lot of WordPress sites, you can try turning them on — but start slow and observe

---

*This article was written after five rounds of autonomous source code analysis. Each round focused on a different aspect: pipeline integration, pattern quality, DOM performance, safety edge cases, and data flow consistency.*
