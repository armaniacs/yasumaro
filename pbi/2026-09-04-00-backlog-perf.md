# Backlog — パフォーマンス最適化 8 件（ベンチ基盤先行 + 抽出/クレンジング/content script/Dashboard/dedup）

現行 Yasumaro 実装のプロファイル観点レビューで特定した高速化候補 7 件と、それらを実測・回帰検出するためのベンチマーク基盤 1 件を、RICE で優先度付けした一覧。ベンチ基盤（01）が残り 7 件の**依存元**であり、RICE スコアに関わらず最優先で着手する。

> ファイル番号（NN）＝着手順（Rank）で一致させている。`NN` を見れば次に何をやるか分かる。

## 優先度一覧

| Rank | PBI | RICE | 内訳 (R×I×C / E) | 根拠 / 依存 |
|------|-----|------|------------------|-------------|
| 01 | [01 feat-perf-benchmark-harness](2026-09-04-01-feat-perf-benchmark-harness.md) | **4.5** | 10×2×0.9 / 4 | 局所ベンチ + e2e ベンチ + 回帰検出。**残り 7 件すべての依存元**（効果測定に必須）。RICE 順に関わらず最優先。既存 `benchmark-cleansing.mjs` と Playwright fixture を再利用 |
| 02 | [02 fix-content-script-polling](2026-09-04-02-fix-content-script-polling.md) | **7.0** | 10×2×0.7 / 2 | 全ページ・全ユーザーで常時走る `requestIdleCallback` 自己再帰ポーリングを、しきい時刻の単発タイマー + scroll 駆動に統合。体感カクつき（Long Tasks/TBT）に直結。依存: 01 |
| 03 | [03 fix-textscore-precompute](2026-09-04-03-fix-textscore-precompute.md) | **7.2** | 9×1×0.8 / 1 | `findMainContentCandidates` の `sort` 比較内で `calculateTextScore` を毎回再計算（O(N log N) 回の TreeWalker 走査）→ 事前計算 1 回 / N。`innerText`→`textContent` でリフロー排除。低コスト高確度。依存: 01 |
| 04 | [04 fix-bytesize-lazy](2026-09-04-04-fix-bytesize-lazy.md) | **4.8** | 9×1×0.8 / 1.5 | `getByteSize`（`new TextEncoder().encode`）を 1 抽出で 6〜10 回 + `Blob` シリアライズ 2 回。値は診断パネル表示時のみ必要 → `returnInfo=false` 経路で計測を全スキップ。依存: 01 |
| 05 | [05 fix-qsa-deep-shortcircuit](2026-09-04-05-fix-qsa-deep-shortcircuit.md) | **3.7** | 8×1×0.7 / 1.5 | `querySelectorAllDeep` が再帰の各レベルで `querySelectorAll('*')` 全列挙。Shadow/iframe 無しページ（大多数）で再帰ゼロ化 + 検出をルール間で 1 回に共有。依存: 01 |
| 06 | [06 fix-clone-node-dedup](2026-09-04-06-fix-clone-node-dedup.md) | **2.4** | 8×1×0.6 / 2 | 候補要素の `cloneNode(true)` をオーケストレータと `cleanseAISummaryContent` 内で 2 回 → `alreadyCloned` オプションで 1 回に。大きな記事でクローンコスト半減。副作用リスクで Conf 低。依存: 01、**04 と同ファイル**（04→06 順でコンフリクト減） |
| 07 | [07 fix-dashboard-query-cache](2026-09-04-07-fix-dashboard-query-cache.md) | **1.4** | 4×1×0.7 / 2 | 履歴パネルのほぼ全操作が SQLite クエリ再発行。パラメータキーの LRU キャッシュ + ソート設定のメモリ常駐化 + persist の debounce。Dashboard を開くユーザーのみ。依存: 01 |
| 08 | [08 fix-dedup-simhash](2026-09-04-08-fix-dedup-simhash.md) | **0.7** | 3×1×0.7 / 3 | `deduplicateContent` の O(N^2) 全ペア Jaccard を事前フィルタ（結果一致）or SimHash/LSH（近似）で削減。重複除去はオプトイン機能で Reach 低。依存: 01 |

**RICE 定義:** `Score = (Reach × Impact × Confidence) / Effort`。Reach = 影響ユーザー割合（全ユーザー = 10）、Impact = 3 圧倒的 / 2 大 / 1 中 / 0.5 小、Confidence = 0.5〜1、Effort = 人日。

**順序の補正（依存 > スコア）:**
- **01 はスコア（4.5、02/03 より低い）に関わらず Rank 1**。残り 7 件は 01 のベンチがないと「速くなったか / 他を遅くしていないか」を数値化できない。依存はスコアより優先。
- 02〜08 は RICE 降順で 03(7.2) → 02(7.0) → 04(4.8) → 05(3.7) → 06(2.4) → 07(1.4) → 08(0.7)。ただし 02（周期ポーリング廃止）は content script の体感影響が最も直接的で、01 完成後の TBT 改善が最も見えやすい。03 とは僅差（0.2）のため時間的インパクトの緊急性で **02 を 03 の前**に置く。
- 06 は 04 と同一ファイル（`contentExtractor/index.ts`・`aiSummaryCleaner/index.ts`）を触るため、04 → 06 の順にしてマージコンフリクトを避ける。

## なぜなぜ分析サマリ

| PBI | 原因 → 示唆 → 解 |
|-----|------------------|
| 01 harness | 最適化候補が推測ベース → 「速くなった」の判断材料がない → 局所ベンチ（jsdom, 走査数 + P50/P95/P99 + スケーリング曲線）と e2e ベンチ（自動保存 e2e 時間 + TBT + メモリ + Lighthouse）+ CI 回帰検出（baseline 比 +15%）を先に作る |
| 02 polling | `scheduleNextCheck` が自己再帰で永続ポーリング → アイドルコールバック連鎖 + 毎回 `new VisitGate` → しきい時刻の残余で単発タイマー 1 本、scroll は既存ハンドラに一本化、gate/しきい値は init で 1 回生成 |
| 03 textscore | `sort` 比較関数が `calculateTextScore` を呼ぶ → 候補 N に対し O(N log N) 回の TreeWalker 走査 → `map` で 1 回だけスコア算出してからソート、`innerText` は不要なので `textContent` に |
| 04 bytesize | `getByteSize` が `new TextEncoder()` を毎回生成し body 全体をエンコード → 値は診断パネル専用 → `returnInfo=false` で計測全スキップ、フォールバック判定用の最小バイト計算だけ残す、ENCODER をモジュールスコープ共有 |
| 05 qsa-deep | `querySelectorAllDeep` が再帰レベルごとに `querySelectorAll('*')` 全列挙してホストを探す → Shadow/iframe 無しでも全走査 → 入口で `findDeepHosts` を 1 回、ホストが 0 なら素の `querySelectorAll` に短絡、検出結果をルール間で共有 |
| 06 clone | オーケストレータの clone を渡しているのに `cleanseAISummaryContent` が再クローン → 大ノードのディープコピー 2 回 → `alreadyCloned` オプションで内部クローンをスキップ、3 経路で 1 clone を使い回す |
| 07 query-cache | 履歴パネルの全アクションが `fetchData` → クエリ再発行、ソート変更ごとに storage 往復 → パラメータキーの LRU キャッシュ（データ変更で全無効化、レースガードと整合）、ソート設定は起動時 1 回読み + persist を 500ms debounce |
| 08 dedup | 全ペア Jaccard 比較で O(N^2) → 長文で二乗爆発 → まず事前フィルタ（文字数比・先頭 n-gram で足切り、結果完全一致）、目標未達なら SimHash + LSH バケット（近似、取りこぼし率をドキュメント化） |

## 依存グラフ

```
01 harness ─┬─> 02 polling        (c5 bench)
            ├─> 03 textscore      (c2 bench)
            ├─> 04 bytesize ──> 06 clone   (同ファイル、04 先行)  (c1 / c4 bench)
            ├─> 05 qsa-deep       (c3 bench)
            ├─> 07 query-cache    (c6 bench)
            └─> 08 dedup          (c7 bench)

02〜05, 07, 08 は 01 完了後は互いに独立（並行実装可）。
06 のみ 04 の後。
```

## ベンチ基盤（01）の指標マッピング

| 候補 | 局所ベンチ (`bench/micro/`) | e2e ベンチ (`bench/e2e/`) |
|------|---------------------------|--------------------------|
| 02 polling | c5: FakeScheduler 仮想時間の schedule 回数 + コールバック累積時間 | autosave-latency, Long Tasks/TBT |
| 03 textscore | c2: TreeWalker 走査ノード数, reflow カウンタ, P95, スケーリング曲線 | autosave-latency |
| 04 bytesize | c1: `TextEncoder.encode` 回数, heapUsed 差分, P95 | autosave-latency, メモリ |
| 05 qsa-deep | c3: `querySelectorAll('*')` 回数, 走査ノード総数, P95 | autosave-latency |
| 06 clone | c4: `cloneNode` 回数, heapUsed ピーク差分, P95 | autosave-latency, メモリ |
| 07 query-cache | c6: `queryHistory` 呼び出し回数, `chrome.storage` get/set 回数 | (Dashboard 操作シナリオ) |
| 08 dedup | c7: `jaccardSimilarity` 回数, スケーリング指数, P95 | autosave-latency（dedup 有効時） |

共通指標: wall-clock P50/P95/P99、CPU 時間、メモリ（heapUsed / measureUserAgentSpecificMemory）、Lighthouse（LCP/TBT/CLS/INP）、content script 注入あり/なし A/B、SW cold start。CI: CPU 4x throttle 固定 + baseline JSON 比較で +15% 回帰を exit 1。

## 補足

- 対象コードはすべてレビュー済み（`contentExtractor/index.ts`, `scoring.ts`, `contentKernel.ts`, `aiSummaryCleaner/helpers.ts`, `contentDeduplicator.ts`, `sqliteHistoryModel.ts`）。未解決の疑問なし
- 測定軸はユーザー合意済み
- 各 PBI の「テスト戦略」に、01 の `npm run bench:micro -- --filter cN` を使った before/after 添付フローを固定文言で記載済み
