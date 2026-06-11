---
title: "クレンジングパイプラインを「見える化」する — 4段階削減率の可視化"
emoji: "📊"
type: "tech"
topics: ["obsidian", "chrome拡張機能", "ai", "自動化"]
published: false
---

Obsidian Weave がウェブページを記録するとき、バックグラウンドで4段階の「テキスト絞り込み」が走っています。

```
DOM全体 → コンテンツ候補 → Content Cleansing後 → AI Summary Cleansing後
pageBytes  candidateBytes    cleansedBytes          aiSummaryCleansedBytes
```

この数値は `chrome.storage.local` に蓄積され続けているのですが、これまで使い道がありませんでした。v5.1では、この4段階のバイト数をグラフと統計サマリーとして可視化します。

## なぜ「削減率の見える化」が重要なのか

### トークンコストは入力サイズに比例する

現在の主要AIプロバイダー（OpenAI、Anthropic、Google）はいずれもトークン単位の課金モデルを採用しています。要約精度とは独立して、入力テキストが長ければ長いほどコストは上がります。

典型的なニュースサイトのHTMLは300〜800 KB程度あります。そのうち本文として意味のある部分は多くても数十 KBです。差分のほとんどはナビゲーション、広告スクリプト、フッター、関連記事リスト——AIが「このページは何についてですか」と問われたときに全く参照しないコンテンツです。

削減率を可視化することで、「このサイトはほとんどノイズだ」「このサイトはクレンジングが効いていない」という判断が初めてできるようになります。

### Lost in the Middle 問題

スタンフォードの研究チームが2023年に発表した「Lost in the Middle」論文（Liu et al., 2023）は、LLMに長い文書を与えたとき、文書の**中間部分への注意が低下する**ことを実証しました。

実験では、20〜30件の文書を並べてどれかに答えが含まれるマルチドキュメントQAタスクで、答えが文書リストの先頭や末尾にあるときは正確に回答できるが、中間にあるときは精度が著しく低下することが示されました。

```
正確率（答えの位置による）
先頭: 71%
中間: 52%  ← 20ポイント低下
末尾: 68%
```

これはシングルドキュメント要約でも同様の傾向があります。長い文書の「本文中間」にある重要情報がモデルに無視されるリスクは、入力を短くすることで下げられます。

削減率の統計サマリーを眺めることで、「このサイトでの削減効果は平均XX%なので、要約精度に影響している可能性がある」という観察ができるようになります。

## 実装する可視化の3要素

### 案A: 統計サマリーカード

AI Summary Cleansingパネルに3枚のカードを追加します。

| カード | 内容 |
|--------|------|
| 平均削減率 | `(pageBytes - 最終バイト) / pageBytes × 100` の平均値（%） |
| 累計削減量 | 全エントリの `pageBytes - 最終バイト` の合計（KB換算） |
| 集計対象 | 有効データのあるエントリ件数 |

累計削減量は「今まで何 KB のノイズを AI から遠ざけたか」を示す数値です。節約したトークンコストの概算としても機能します。

### 案B: ファネルチャート（Canvas API）

4段階の平均バイト数を横向きのファネル（漏斗）チャートとして描画します。Chrome Extensionの `script-src 'self'` CSP制約により外部チャートライブラリは使えないため、Canvas 2D APIで直接描画します。

```
pageBytes      ████████████████████████████  (100%)
candidateBytes ████████████████              ( 60%)
cleansedBytes  ████████████                  ( 45%)
aiCleansed     ████████                      ( 30%)
```

各バーの右側に実際のバイト数とパーセンテージを表示します。データが0件のときはCanvas要素ごと非表示にします（空のグラフは情報を与えないため）。

### 案C: プログレスバー（インライン表示）

履歴リストの各エントリに、既存のテキスト行に加えてプログレスバーを追加します。

```
コンテンツ抽出 — バイト: 248,320 → 12,840（94.8%削減）
[████████████████████████████████░░░░░░░░] 94.8%
```

テキスト行はそのまま残し、プログレスバーを下に追加します。視覚的な即時フィードバックが目的です。

## 集計ロジックの設計

集計関数 `computeCleansingStats()` は `SavedUrlEntry[]` を受け取り、`CleansingStats` を返します。

```typescript
interface CleansingStats {
  count: number;
  avgPageBytes: number;
  avgFinalBytes: number;
  avgReductionRate: number;      // %
  totalSavedBytes: number;       // bytes (表示はMB換算)
  funnelAvg: {
    page: number;
    candidate: number;
    cleansed: number;
    aiCleansed: number;
  };
}
```

各エントリで `pageBytes` と `aiSummaryCleansedBytes` が両方存在するものだけを対象にします。片方しかない（クレンジング無効で記録されたエントリ等）はスキップします。

## Canvas描画の詳細

ファネルチャートはCanvas 2D APIで以下の手順で描画します。

```typescript
function renderFunnelChart(canvas: HTMLCanvasElement, stats: CleansingStats): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return; // jsdom など getContext が null の環境に対応

  const labels = ['DOM全体', '候補絞込', 'Content\nCleansing', 'AI要約\nクレンジング'];
  const values = [
    stats.funnelAvg.page, stats.funnelAvg.candidate,
    stats.funnelAvg.cleansed, stats.funnelAvg.aiCleansed,
  ];
  const maxVal = values[0];

  values.forEach((val, i) => {
    const isLast = i === values.length - 1;
    // 最終段のみ緑（#10b981）、それ以外は紫（#7c3aed）を透明度で変化
    const color = isLast ? '#10b981' : '#7c3aed';
    const barWidth = (val / maxVal) * chartWidth;
    // 描画処理...
  });
}
```

パネルが非表示のときCanvasの幅は0になります。`requestAnimationFrame` 内で描画することでレイアウト確定後に正しい幅を取得できます。

## パネル切り替え時の再描画

Dashboardのパネルナビゲーションで「AI Summary Cleansing」パネルに切り替えたとき、毎回 `chrome.storage.local` からデータを取得して再描画します。

キャッシュは持ちません。`chrome.storage.local` の読み取りは同一プロセス内では十分高速（< 5ms）であり、データが増えても表示の鮮度を保てます。

```typescript
// dashboard.ts のパネル切り替えハンドラー内
if (panelId === 'panel-ai-summary-cleansing') {
  requestAnimationFrame(async () => {
    const entries = await getSavedUrlEntries();
    updateCleansingStatsPanel(entries);
  });
}
```

## まとめ

v5.1の可視化機能は、既存のパイプラインが蓄積してきたバイト計測データを初めて「目に見える形」にします。

- **統計サマリーカード**: サイト横断の集計を一目で把握
- **ファネルチャート**: 4段階どこで削減が効いているかを視覚化
- **プログレスバー**: 各記録エントリの削減効果をインライン表示

次の記事では、可視化のデータを実際に改善するための品質改善施策——リンク密度フィルタのON化、事実制約プロンプト、入力冗長除去、文末正規化——を解説します。
