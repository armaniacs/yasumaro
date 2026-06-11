---
title: "AI要約の品質を4段階で改善する — リンク密度・事実制約・重複除去・文末正規化"
emoji: "🎯"
type: "tech"
topics: ["obsidian", "chrome拡張機能", "ai", "自動化", "nlp"]
published: false
---

v5.1では、ウェブページ要約の品質を改善する4つの施策を実装します。

それぞれ独立した改善で、優先度の高いものから順に適用します。

| 優先度 | 施策 | 変更規模 | 主な効果 |
|--------|------|----------|----------|
| 1 | リンク密度フィルタ デフォルトON | 定数2箇所 | ナビゲーションブロック除去 |
| 2 | デフォルトプロンプトに事実制約追加 | 文字列定数変更 | ハルシネーション抑制 |
| 3 | MMR相当の入力冗長除去 | 新規ファイル追加 | 重複トークン削減 |
| 4 | 文末正規化ポストプロセス | 新規ファイル追加 | 日本語情報密度向上 |

## 施策1: リンク密度フィルタのデフォルトON化

### 問題: 関連記事リストは要約を汚染する

ニュースサイトや技術ブログには、記事本文の下に「関連記事」「おすすめ記事」のリストが大量に並びます。これらは本文と同じDOM構造に存在するため、コンテンツ候補として取り込まれてしまいます。

```html
<div class="related-articles">
  <a href="/article/1">AIが変える未来の働き方</a>
  <a href="/article/2">ChatGPTで生産性が10倍に</a>
  <a href="/article/3">エンジニア必見のAIツール15選</a>
  ...（20件続く）
</div>
```

このブロックをAIに渡すと、要約に「関連記事として〜〜があります」のような内容が混入します。本文の要約ではなく、リンクリストの要約になってしまうわけです。

### 解決: リンク比率による自動除去

AI Summary Cleansingの「リンク密度フィルタ」は、テキスト全体に占めるアンカーテキストの割合が70%以上かつ100文字以上の要素を除去します。

```typescript
function stripHighLinkDensityElements(doc: Document): number {
  const elements = doc.querySelectorAll('div, section, nav, ul, ol');
  let count = 0;
  for (const el of elements) {
    const totalLength = el.textContent?.length ?? 0;
    if (totalLength < 100) continue;  // 短すぎる要素は除外
    const linkLength = [...el.querySelectorAll('a')]
      .reduce((sum, a) => sum + (a.textContent?.length ?? 0), 0);
    if (linkLength / totalLength >= 0.70) {
      el.remove();
      count++;
    }
  }
  return count;
}
```

この機能は既に実装・テスト済みですが、デフォルト値が `false` でした。v5.1でデフォルトを `true` に変更します。既存設定を持つユーザーには影響しません（保存済みの `false` が優先されます）。

## 施策2: デフォルトプロンプトに事実制約を追加

### 問題: 外在的ハルシネーション

LLMのハルシネーションには2種類あります。

**内在的ハルシネーション（Intrinsic Hallucination）**: 入力文書の内容と矛盾する内容を生成する。
**外在的ハルシネーション（Extrinsic Hallucination）**: 入力文書に存在しない情報を、事前学習知識から補完して生成する。

前者は検出しやすいですが、後者は「一見もっともらしく見える」という厄介な性質があります。たとえば、ある製品の記事を要約するとき、その製品についてモデルが事前学習で学んだ知識を混入させてしまうケースです。

### 解決: システムプロンプトへの事実制約

デフォルトのシステムプロンプトに制約文を追加します。

**変更前:**
```
You are a helpful assistant that summarizes web pages effectively and concisely in Japanese.
```

**変更後:**
```
You are a helpful assistant that summarizes web pages effectively and concisely in Japanese.
Only use information explicitly stated in the provided content. Do not add facts, context, or details not present in the source text.
```

プロンプトによる制約の効果はモデルによって差があります。ただし、コストゼロで適用できる改善であり、少なくとも「外在的ハルシネーションを許容しない意図をモデルに伝える」効果は期待できます。

ユーザーがカスタムプロンプトを使用している場合はこの変更の影響を受けません。

## 施策3: MMR相当の入力冗長除去

### 背景: Maximal Marginal Relevance

**MMR（Maximal Marginal Relevance）** は1998年にCarbonellとGoldsteinが提案した文書選択アルゴリズムです。元々は検索結果の多様性確保のために設計されましたが、文書要約の前処理としても使われます。

アルゴリズムのコアアイデアは「関連性を最大化しつつ、すでに選択した内容との重複を最小化する」です。

```
MMRスコア = λ × 関連性(si, Query) - (1-λ) × max similarity(si, Sj)
                                              j∈S_selected
```

v5.1では、クエリとの関連性スコアは使わず（クエリが存在しないため）、**類似した文を重複として除去する**部分のみを実装します。

### Jaccard類似度による重複検出

センテンスレベルの重複除去には Jaccard 類似度を使います。

```typescript
function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(/\s+/));
  const setB = new Set(b.split(/\s+/));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}
```

Jaccard類似度は「2つの集合の積集合サイズ / 和集合サイズ」です。単語の出現順序を無視するため、言い換えや語順の違いを持つ重複文の検出に向いています。

### 実装: deduplicateContent()

```typescript
export function deduplicateContent(text: string, threshold = 0.7): string {
  const sentences = text.split(/(?<=[。．.!?！？])\s*/);
  const selected: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    const isDuplicate = selected.some(
      s => jaccardSimilarity(trimmed, s) >= threshold
    );

    if (!isDuplicate) {
      selected.push(trimmed);
    }
  }

  return selected.join(' ');
}
```

閾値 `threshold` はデフォルト0.7で、スライダーUIで0.5〜0.95の範囲で変更できます。低くするほど積極的に除去します。

### なぜBERTベースの類似度を使わないか

BERTやSentence Transformersを使ったセマンティック類似度はJaccardより高精度ですが、Chrome Extensionの制約（CSP、サービスワーカー、モデルファイルサイズ）から実装は現実的ではありません。Jaccard類似度は軽量かつ説明可能で、コピー&ペーストされた重複コンテンツ（同じ文が複数回現れるケース）には十分な精度があります。

## 施策4: 文末正規化ポストプロセス

### 問題: 日本語要約の情報密度

日本語のAI要約でよく見られるパターンがあります。

```
このページは、〇〇について詳しく説明しています。
〇〇は〜〜という特徴があります。
〜〜することができます。
〜〜を提供しています。
```

「〜しています」「〜することができます」という丁寧体（ます体）は、それ自体が情報を持ちません。常体（だ体）に変換することで文字数を減らし、情報密度を上げられます。

### 安全な5パターンのみ変換

文末変換には「意味を変えてしまうリスク」があります。たとえば `ます。→ る。` という単純置換は「増加します。→ 増加する。」のように意図通りに動作しますが、文脈によっては不自然になることがあります。

v5.1では**安全性を最優先**し、以下の5パターンのみを変換します。

| 変換前 | 変換後 | リスク評価 |
|--------|--------|----------|
| `です。` | `だ。` | 低（判定詞の直接置換） |
| `でした。` | `だった。` | 低（過去形の置換） |
| `ています。` | `ている。` | 低（進行形の置換） |
| `ていました。` | `ていた。` | 低（進行過去形の置換） |
| `でしょう。` | `だろう。` | 低（推量の置換） |

`ます。→ る。` や `ました。→ た。` は除外します。動詞語幹が変わらずに活用だけ変換するケースは、連濁や不規則活用により誤変換が起きやすいためです。

### 実装: normalizeJapaneseSummary()

```typescript
const NORMALIZATION_PATTERNS: Array<[RegExp, string]> = [
  [/です。/g, 'だ。'],
  [/でした。/g, 'だった。'],
  [/ています。/g, 'ている。'],
  [/ていました。/g, 'ていた。'],
  [/でしょう。/g, 'だろう。'],
];

export function normalizeJapaneseSummary(text: string): string {
  let result = text;
  for (const [pattern, replacement] of NORMALIZATION_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}
```

この関数は Obsidian への書き込み直前（`generateSummary()` 呼び出し後）に適用します。英語要約や言語検出の仕組みは持たず、英語テキストに適用しても影響はありません（パターンが一致しないため）。

## UI: Contentパネルへの設定追加

③と④はユーザーがOFFにできます。`panel-content` の末尾に新セクションを追加します。

```html
<!-- dashboard.html の panel-content 末尾に追加 -->
<section class="settings-section">
  <h3 data-i18n="textQualitySettingsTitle">テキスト品質設定</h3>

  <label class="checkbox-label">
    <input type="checkbox" id="contentDedupEnabled" />
    <span data-i18n="contentDedupEnabledLabel">入力重複除去</span>
  </label>

  <div id="contentDedupThresholdRow">
    <label>
      <span data-i18n="contentDedupThresholdLabel">類似度閾値</span>
      <input type="range" id="contentDedupThreshold"
             min="0.5" max="0.95" step="0.05" value="0.7" />
      <span id="contentDedupThresholdValue">0.7</span>
    </label>
  </div>

  <label class="checkbox-label">
    <input type="checkbox" id="summaryNormalizeEnabled" />
    <span data-i18n="summaryNormalizeEnabledLabel">文末正規化（日本語）</span>
  </label>
</section>
```

## BERTScore と忠実性の関係

参考として、NLP研究から重要な知見を紹介します。

**BERTScore** は生成テキストと参照テキストの意味的類似度を計算するメトリクスです。高いほど「参照テキストに似ている」ことを意味します。

一方、**AlignScore**（Zha et al., 2023）は生成テキストがソース文書に「忠実かどうか」を測るメトリクスです。

興味深いことに、いくつかの要約タスクにおいてBERTScoreとAlignScore（忠実性）の間に**負の相関**が報告されています。つまり、「参照要約に似ている」テキストが「ソース文書に忠実」とは限らないということです。

これは評価の難しさを示しています。「良い要約」の定義が、「参照テキストに近いか」と「事実に忠実か」で競合することがある。v5.1の施策2（事実制約プロンプト）はこのトレードオフを認識した上で、**忠実性を優先する**方向の選択です。

## まとめ

4つの施策はすべて独立しており、順番に適用できます。

1. **リンク密度フィルタON**: ゼロコストで既存機能を有効化
2. **事実制約プロンプト**: ゼロコストでハルシネーションリスク低減
3. **入力冗長除去**: Jaccardベースの軽量実装でトークン削減
4. **文末正規化**: 安全な5パターンのみで情報密度向上

可視化（v5.1施策1）で削減率の現状を把握した上で、これらの改善を適用していく流れです。施策3・4はOFFにできるので、効果を実感できなければ無効化できます。
