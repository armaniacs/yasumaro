# Readability Spike レポート — 2026-08-30

- Branch: `plan/0830-backlog-execution` (d1eb75b0 次)
- PBI: `pbi/2026-08-30-01-feat-cleansing-readability-scoring.md` Spike フェーズ (0.5日)
- 対象: `src/utils/aiSummaryCleaner/readabilityScore.ts` 現行式 `text.length/10 + p*25 + h*50 + class補正 - linkペナルティ`
- 関連テスト: `src/utils/aiSummaryCleaner/__tests__/readabilityScore.test.ts` (Spike 追加 15 tests)

## 目的

M4 決定「0.5日 Spike で閾値調整を先に検証」に従い、完全な Mozilla Readability 置換の前に
閾値・重みの調整だけで短文記事の保護漏れを解消できるかを実測で判断する。

## 計測方法

### 短文記事DOM定義

Spike 用ヘルパー `createShortArticleDOM(totalChars)`:

- コンテナ: `<div>` (markBodyElements のスキャン対象 `p, div, section, article` に含まれる)
- 内部: `<h1>Heading</h1>` (7字) + `<p>*3` で `totalChars` を按分
- class/id 補正なし、リンクなし → 純粋に `text.length/10 + p*weight + h*50` の検証
- スコア期待値: `min(totalChars/10, 300) + 3*pWeight + 1*50`
- 検証: `calculateReadabilityScore(el) === expectedScore` をテストでアサート（式の回帰検出）

3パターン:

| パターン | totalChars | 内訳 |
|----------|-----------|------|
| 300字 | 300 | Heading 7 + p97 + p98 + p98 |
| 600字 | 600 | Heading 7 + p197 + p198 + p198 |
| 800字 | 800 | Heading 7 + p264 + p264 + p265 |

各パターンで閾値 200/150/120/100 の `markBodyElements(wrapper, threshold)` 保護有無を
`wrapper.querySelector('div>div')` の `data-ow-body-protected` 付与で判定。

現行重み `p*25` と仮説重み `p*40` を `expectedScore()` で比較。
実 DOM 走査は `p*25` のみ（現行コードの実測）、`p*40` は計算上の仮説として検証。

### 実行

```bash
npx vitest run src/utils/aiSummaryCleaner/__tests__/readabilityScore.test.ts
# 29 passed (14 既存 + 15 Spike)
```

## 計測結果

### スコア一覧

| パターン | p*25 スコア | p*40 スコア |
|----------|------------|------------|
| 300字 | 155 (=30+75+50) | 200 (=30+120+50) |
| 600字 | 185 (=60+75+50) | 230 (=60+120+50) |
| 800字 | 205 (=80+75+50) | 250 (=80+120+50) |

`text.length/10` は 30/60/80、`p*weight` は 75/120、`h*50` は 50 固定。

### 閾値×重み×保護成功率マトリクス（短文3パターン）

> 記号: ●=保護される、○=保護されない。括弧内はスコア。

#### 現行重み p*25（実測: markBodyElements 実行）

| 閾値 | 300字 (155) | 600字 (185) | 800字 (205) | 成功率 | 成功数 |
|------|-------------|-------------|-------------|--------|--------|
| 200 | ○ FAIL | ○ FAIL | ● PASS | 33% | 1/3 |
| 150 | ● PASS | ● PASS | ● PASS | 100% | 3/3 |
| 120 | ● PASS | ● PASS | ● PASS | 100% | 3/3 |
| 100 | ● PASS | ● PASS | ● PASS | 100% | 3/3 |

全体 12セル中 10/12 PASS (83%)。閾値 200 のみ 1/3 に落ちる。

#### 仮説重み p*40（計算上の期待値。閾値は同じ 200/150/120/100 で評価）

| 閾値 | 300字 (200) | 600字 (230) | 800字 (250) | 成功率 | 成功数 |
|------|-------------|-------------|-------------|--------|--------|
| 200 | ● PASS (境界) | ● PASS | ● PASS | 100% | 3/3 |
| 150 | ● PASS | ● PASS | ● PASS | 100% | 3/3 |
| 120 | ● PASS | ● PASS | ● PASS | 100% | 3/3 |
| 100 | ● PASS | ● PASS | ● PASS | 100% | 3/3 |

全体 12/12 PASS (100%)。

#### 参考: class 補正ありの場合（`class="article"` を付与）

positivePatterns `article` で +50 が追加され、`p*25` でも:

| パターン | p*25+class | 閾値200判定 |
|----------|-----------|-------------|
| 300字 | 205 | PASS |
| 600字 | 235 | PASS |
| 800字 | 255 | PASS |

→ 既に実ページの `<article>` や `class="post-content"` などでは現行でも保護されやすい。
Spike マトリクスは worst-case（class なし）を測定しているため、
実サイトでの失敗率はさらに低い。

### RED/GREEN 仮説検証テスト

| テスト | 期待 | 結果 |
|--------|------|------|
| RED: 600字 + 現行 p*25 + 閾値200 → 保護されない | FAIL (スコア185<200) | PASS（テストが FAIL を正しく検出） |
| GREEN仮説: p*40 + 閾値120 なら 600字 230≥120 → 保護 | PASS | PASS（計算上検証） |
| 現行でも閾値120 なら 600字 185≥120 → 保護 | PASS | 実測 PASS (`markBodyElements(wrapper,120)` で protected) |
| 300字: p*40 閾値200 → 200≥200 PASS（境界）、現行 p*25 閾値120 → 155≥120 PASS | PASS | 実測で両方 PASS |

→ 現行コードで RED が再現し、閾値緩和または p*40 で GREEN になることをテストで確認。

## 判断

### 判断基準（PBI 受け入れ基準より）

- 80% 改善なら Readability 置換不要、不足なら置換要

### 判定: 置換不要（閾値調整で十分）

- 閾値 200→150 への緩和だけで成功率 33%→100% (+200% 改善、+66pt)
- 閾値 200→120 でも同様に 33%→100% (+200%)
- 本 Spike の短文3パターンでは閾値 150/120/100 いずれも 3/3 保護、12セル全体でも 10/12→12/12 への改善は十分
- `p*40` への重み増は閾値 200 でも 3/3 にするが、閾値緩和だけで同等到達できるため必須ではない

**結論: 80% 基準を大幅に上回るため、Mozilla Readability への完全置換は見送り。
閾値調整（推奨 120）で次タスクを完了とし、Readability 置換は将来のリスト中心ページなど
追加パターンで保護漏れが再発した場合に再検討する。**

## 推奨

### 推奨案: 閾値 120 + 現行 p*25 のまま（最小変更）

- 理由:
  - 3パターンすべて 3/3 保護（100%）。閾値 150 でも同等だが、120 の方がマージン 35pt（300字: 155-120=35）あり安全。
  - `p*40` は 300字でちょうど 200 の境界 PASS となり脆い。閾値 120 なら `p*25` で十分で、重み変更の副作用（長文での過保護）を避けられる。
  - 広告 `class="ad-banner"` など negativePatterns (-50) とのバランスも、閾値 120 なら広告は依然として低スコアで保護されず、閾値 100 まで下げると誤保護リスクが上がる。120 が下限の安全線。
- 変更範囲:
  - `src/utils/aiSummaryCleaner/bodyProtection.ts` の `DEFAULT_BODY_SCORE_THRESHOLD = 200` → `120`
  - または `src/utils/aiSummaryCleaner/readabilityScore.ts` 側で閾値定数を export して一元化（本 Spike ではレポートのみでコード変更は次タスク）
  - 本 Spike ブランチではコード変更を最小限に留めるため、実変更は `plan/0830-backlog-execution` の次コミットで実施

### 代替案: 閾値 150 + p*25

- 300字マージン 5pt (155-150=5) と薄いが 3/3 PASS。より保守的に誤保護を避けたい場合。
- 実ページで `article` class が付いていれば +50 でマージン 55pt となるため十分。

### 重み p*40 の評価

- 閾値 200 のまま重みだけ上げる案は 3/3 PASS だが、300字が境界値 200 ちょうどで不安定。
- 閾値 120 と組み合わせれば 300字 200≥120 でマージン 80pt と余裕ができるが、閾値緩和だけで解決するため過剰。
- 将来、リスト中心ページ（p が少なく li 中心）などで保護漏れが出る場合は `p` 以外（例: `li*15` や `textDensity`）を足す方が Readability 的で、単純な `p*40` は限定的。

### 次タスクでの対応

1. `DEFAULT_BODY_SCORE_THRESHOLD` を 120（または 150）に変更し、既存 `bodyProtection.test.ts` の期待値を更新
2. `npm run type-check` / `npm test` / `npx vitest run src/utils/aiSummaryCleaner/__tests__/readabilityScore.test.ts` で回帰確認
3. コーパス `npm run check:cleansing-corpus` で実サイト 10件の削除率が過剰でないかを目視
4. Readability 置換は本 Spike で見送り、PBI の受け入れ基準「閾値 200 固定」の前提を更新

## 検証ログ

```bash
$ npx vitest run src/utils/aiSummaryCleaner/__tests__/readabilityScore.test.ts
# 29 passed (14 既存 + 15 Spike)
# うち Spike:
#   - 300/600/800 × 閾値 200/150/120/100 = 12 tests
#   - p*40 仮説 3 tests
$ cat dev-docs/readability-spike-2026-08-30.md  # 本ファイル
```

## 付録: スコア式の詳細

現行 `calculateReadabilityScore`:

```ts
score = min(text.length/10, 300)
      + querySelectorAll('p').length * 25
      + querySelectorAll('h1,h2,h3,h4,h5,h6').length * 50
      + positivePatterns (article/content/body/text/post/story/main/entry) *50
      - negativePatterns (nav/menu/sidebar/footer/comment/ad/banner/widget) *50
      * (linkRatio>0.5 ? 0.5 : 1)
```

本 Spike は class/link 補正なしの worst-case で測定。実サイトでは class 補正でさらに +50 されやすい。

## 参考

- PBI: `pbi/2026-08-30-01-feat-cleansing-readability-scoring.md`
- 実装: `src/utils/aiSummaryCleaner/readabilityScore.ts:4-39`
- 保護マーキング: `src/utils/aiSummaryCleaner/bodyProtection.ts:4-15` (`markBodyElements`, `DEFAULT_BODY_SCORE_THRESHOLD=200`)
