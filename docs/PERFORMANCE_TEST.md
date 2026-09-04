# パフォーマンス測定ガイド / Performance Testing Guide

[日本語](#日本語) | [English](#english)

拡張機能のホットパス（コンテンツ抽出・AI 要約クレンジング・content script・Dashboard 履歴パネル）の性能を実測し、最適化の効果と回帰を数値で確認するためのガイド。

- 実装リファレンス: [`bench/README.md`](../bench/README.md)
- 設計背景: [`dev-docs/PERFORMANCE_GUIDE.md`](../dev-docs/PERFORMANCE_GUIDE.md)
- 対象 PBI: `pbi/2026-09-04-00-backlog-perf.md`（最適化 7 件 + 本ベンチ基盤）

---

## 日本語

### 何ができるか

| レイヤ | コマンド | 実行環境 | 測るもの |
|--------|---------|---------|---------|
| **局所ベンチ (micro)** | `npm run bench:micro` | Node + jsdom（ネットワーク不要） | wall-clock P50/P95/P99、DOM 走査数、ヒープ差分、スケーリング指数 |
| **e2e ベンチ** | `npm run bench:e2e` | 実 Chromium + ビルド済み拡張 | 自動保存の同期コスト（extract〜送信準備）、Long Tasks/TBT、メモリ、Lighthouse、Service Worker cold start |
| **回帰チェック (CI)** | `npm run bench:check` | Node + jsdom | ベースライン比で決定的カウンタが +15% 悪化したら exit 1 |
| **レポート掃除** | `npm run bench:clean` | Node | `bench/reports/` をローリング 5 世代 + 週次アンカーで掃除（`-- --all` で全消去） |

局所ベンチ `c1`〜`c7` は最適化 PBI（`pbi/2026-09-04-02`〜`08`）と 1:1 対応。`cleansing` は旧 `benchmark:cleansing` の移行先。

### クイックスタート

```bash
# 全局所ベンチを実行してレポート出力（約2〜3分）
npm run bench:micro

# 特定ベンチだけ（id 前方一致。カンマ区切り可）
npm run bench:micro -- --filter c2,c7

# スモーク実行（warmup 2 / measure 5、約20秒。配線確認用）
npm run bench:micro -- --quick

# e2e ベンチ（先に拡張をビルドすること）
npm run build && npm run bench:e2e
```

出力先:
- レポート: `bench/reports/micro-<日付>.md`（gitignore 対象）
- e2e の生データ: `bench/reports/e2e-*-<日付>.json`

### 局所ベンチの読み方

各ベンチは入力サイズ **S / M / L**（内部倍率 `n`）で計測し、`time ≈ c·Nᵏ` を当てはめてスケーリング指数 `k` を出す。

| k の範囲 | 判定 | 意味 |
|---------|------|------|
| < 0.5 | `sub-linear` | サイズにほぼ依存しない |
| 0.5〜1.35 | `linear` | O(N) |
| 1.35〜1.75 | `super-linear` | O(N log N) 相当 |
| 1.75〜2.5 | `quadratic` | O(N²) |
| ≥ 2.5 | `polynomial-or-worse` | それ以上 |

レポート例:

```
## c7 — sentence dedup O(N^2) Jaccard (PBI-08)

warmup 5 · measure 30 · scaling exponent 1.98 (quadratic)

| Size | N | wall p50 (ms) | wall p95 (ms) | wall p99 (ms) | heap p50 (KB) | counters |
|------|---|---------------|---------------|---------------|---------------|----------|
| S    | 1 | 0.20          | 0.24          | 0.24          | 275           |          |
| L    | 12| 12.4          | 13.1          | 13.9          | 2497          |          |
```

「counters」列には DOM 走査系（`qsa`=`querySelectorAll` 呼び出し数、`treeWalker`=TreeWalker で訪問したノード数、`clone`=`cloneNode(true)` 数、`reflow`=レイアウト連動 getter アクセス数）と、ベンチ固有の値（`c1`=`encode`、`c5`=`schedule_calls`/`callback_ms`、`c6`=`query_calls`/`storage_get`/`storage_set`）が出る。

### 各ベンチと主シグナル

| id | 対象 PBI | フィクスチャ | 見るべき値 |
|----|---------|------------|-----------|
| `c1` | 04 バイト計測遅延化 | news-article | `encode` 数（1抽出で 6-10 回）、heap p50 |
| `c2` | 03 textscore 事前計算 | spa-heavy | `treeWalker` 数、wall p95 |
| `c3` / `c3-shadow` | 05 querySelectorAllDeep 短絡 | news / shadow-dom | `qsa` 数（Shadow なしページで 0〜1 が目標） |
| `c4` | 06 cloneNode 統一 | news-article | `clone` 数、heap p50 |
| `c5` | 02 周期ポーリング廃止 | 合成 | `schedule_calls`（N 秒間の schedule 呼び出し回数） |
| `c6` | 07 Dashboard クエリキャッシュ | fake query/storage | `query_calls`、`storage_set`（操作シーケンス中の回数） |
| `c7` | 08 dedup O(N²) 解消 | long-text | wall p95、**スケーリング指数**（2→1 が目標） |

### 最適化 PBI 実装時のワークフロー

最適化 PBI（02〜08）を実装するときの手順:

```bash
# 1. 実装前にベースラインを取る（対応する id だけでよい）
npm run bench:micro -- --filter c5
cp bench/reports/micro-$(date +%F).md /tmp/before.md

# 2. 実装する

# 3. 実装後に再計測
npm run bench:micro -- --filter c5

# 4. before/after の差分を PR に添付
#    - 対応 micro ベンチの P95 が改善しているか（目標値は各 PBI に記載）
#    - 決定的カウンタ（走査数・呼び出し回数）が減っているか
#    - 無関係な指標が悪化していないか

# 5. e2e に影響する変更なら autosave-latency も添付
npm run build && npm run bench:e2e
```

### 回帰チェック（CI）

`npm run bench:check` はベースライン `bench/baselines/micro.json` と比較し、**決定的カウンタ**（`querySelectorAll` / TreeWalker / `cloneNode` / `encode` の呼び出し数、`c5`/`c6` の呼び出しカウンタ）が **+15%** を超えて悪化したら exit 1。

- wall-clock・ヒープ・スケーリング指数は**ゲートしない**（共有 CI ランナーで ±100% 振れて誤検知するため）。レポートには出るので、PR での before/after 比較にはこちらを使う。
- ベースラインに無い指標は `new` 扱い（失敗にはしない）。
- 改善は常に PASS。

推奨: `src/utils/contentExtractor` / `src/utils/aiSummaryCleaner` / `src/utils/contentDeduplicator` / `src/content` / `src/dashboard/panels/asyncData` を触る PR で CI に組み込む。e2e ベンチは nightly か手動実行（PR 毎は micro のみ）。

### レポートの保持ポリシー

ベンチ実行（micro / e2e）のたびに `bench/reports/` は自動掃除される。

- **ローリング保持**: 日付スタンプ（世代）の新しい順に 5 世代を保持
- **週次アンカー**: 各 ISO 週（UTC）で最新の 1 世代を追加保持（5 世代からあふれた古い世代も週の代表として 1 件残る）
- **削除単位は世代単位**: 同一日付の `.md` / `.html` / `.json` は必ずまとめて削除される
- 日付スタンプを持たないファイルは自動掃除では削除されない。全消去は `npm run bench:clean -- --all`

実行モード（通常 / `--check` / `--update-baseline`）に関係なく、成果物は常に `.md` / `.html` / `.json` の 3 点セットで書き出される。

HTML レポートには **Trend セクション** が含まれる。`bench/reports/` に蓄積された過去の `micro-<日付>.json` を読み、各ベンチの L 指標（wall p50/p95/p99・ヒープ・カウンタ・スケーリング指数）の日付横断 sparkline と最初/最新値を表示する（系列は新しい方から最大 26 世代、schemaVersion 非一致・壊れた JSON はスキップして件数表示）。1 世代のみの時点ではプレースホルダ表示で、日をまたぐ実行の蓄積とともに推移が描かれる。`.html` は依存ゼロの自己完結ファイルなので、そのまま PR に添付・ブラウザオープンできる。自動ブラウザオープンは「`--no-open` 未指定 + CI 以外 + TTY 接続あり（インタラクティブセッション）」のすべてを満たしたときだけ行われる。

### ベースラインの更新

意図的な性能変化があり、新しい基準値を確定したいときだけ:

```bash
npm run bench:baseline
git add bench/baselines/micro.json   # PR で差分をレビューする
```

### e2e ベンチの前提

- `npm run build` で `dist/chromium-mv3/` を生成しておくこと
- headed Chromium が必要（MV3 Service Worker は headless で動かない）。CI / SSH / バックグラウンド実行では該当テストが自動 skip される
- CPU は CDP `Emulation.setCPUThrottlingRate: 4` で固定（マシン差の吸収）
- Lighthouse は任意依存。未インストールなら該当テストは skip（`npm i -D lighthouse` で有効化）
- 自動保存の同期コストは content script の `performance.mark('ow-extract-start')`〜`'ow-send-ready')` 間で計測（`src/content/visitReporter.ts`）。この区間は extract + cleanse の**同期処理のみ**で、Service Worker 側の処理・ストレージ書き込みなどの非同期部分は含まない
- 注入あり/なし A/B は `localStorage.__ow_bench_disable_cs = '1'` で content script を早期 return させて比較（`src/content/loader.ts`）。この制御は **ベンチビルド限定**（`OW_BENCH=1 npm run build`）。通常ビルドではコンパイル時に除去されるため、ページ側から挙動を変えられない

### トラブルシューティング

| 症状 | 対処 |
|------|------|
| `bench:check` が誤検知する | まず `npm run bench:baseline` でベースラインを取り直す。それでも出るなら決定的カウンタが実際に変わっている（コードを確認） |
| ヒープ差分が不安定 | npm スクリプトは `--expose-gc` 付き。他プロセスを止めてアイドルなマシンで実行する |
| e2e が全部 skip される | `npm run build` 済みか、headed 実行できる環境か確認 |
| jsdom の数値が実ブラウザと違う | jsdom はレイアウトしないので絶対値でなく「比率」と「ベースライン差分」で判断する。実ブラウザ計測は e2e ベンチで |

### ファイル構成

```
bench/
  harness/       stats / domEnv / bundle / runner / report / cli
  micro/         c1-c7 + cleansing（各 definition を export）
  e2e/           *.bench.ts + _fixtures.ts + server.mjs
  fixtures/      _sizes.mjs（S/M/L 合成ジェネレータ）
  baselines/     micro.json（コミット対象）
  reports/       生成物（gitignore）
  playwright.bench.config.ts
```

---

## English

### What it does

| Layer | Command | Environment | Measures |
|-------|---------|-------------|----------|
| **Micro** | `npm run bench:micro` | Node + jsdom, no network | wall-clock P50/P95/P99, DOM scan counts, heap deltas, scaling exponent |
| **E2E** | `npm run bench:e2e` | headed Chromium + built extension | autosave sync cost (extract → send-ready), Long Tasks/TBT, memory, Lighthouse, SW cold start |
| **Regression check (CI)** | `npm run bench:check` | Node + jsdom | exit 1 when a deterministic counter is >15% worse than baseline |
| **Report cleanup** | `npm run bench:clean` | Node | Prunes `bench/reports/` to rolling 5 generations + weekly anchors (`-- --all` wipes everything) |

Micro benches `c1`–`c7` map 1:1 to the optimization PBIs (`pbi/2026-09-04-02`…`08`).

### Quick start

```bash
npm run bench:micro                     # all micro benches -> bench/reports/micro-<date>.md
npm run bench:micro -- --filter c2,c7    # subset (id prefix match)
npm run bench:micro -- --quick           # smoke (warmup 2 / measure 5, ~20s)
npm run build && npm run bench:e2e        # e2e suite (needs dist/chromium-mv3)
```

### Reading a micro report

Each bench runs at sizes **S / M / L** and fits `time ≈ c·Nᵏ`. The exponent `k`
tells O(N) (`linear`, ~1.0) apart from O(N²) (`quadratic`, ~2.0). The `counters`
column shows `querySelectorAll` calls (`qsa`), TreeWalker nodes visited
(`treeWalker`), deep `cloneNode` calls (`clone`), layout-getter reads (`reflow`),
and per-bench counters (`encode`, `schedule_calls`, `query_calls`, `storage_set`).

### Workflow when implementing an optimization PBI

```bash
npm run bench:micro -- --filter c5        # 1. baseline before the change
# 2. implement
npm run bench:micro -- --filter c5        # 3. re-measure
# 4. attach the before/after diff to the PR:
#    - target bench P95 improved (goal stated in the PBI)
#    - deterministic counters dropped
#    - no unrelated metric got worse
npm run build && npm run bench:e2e        # 5. if it affects e2e, attach autosave-latency too
```

### Regression check (CI)

`npm run bench:check` compares to `bench/baselines/micro.json` and **fails only
on deterministic counters** (`querySelectorAll` / TreeWalker / `cloneNode` /
`encode` calls, and the `c5`/`c6` call counters) that regress past **+15%**.

Wall-clock, heap and the scaling exponent are **reported but not gated** — a
shared CI runner swings them ±100% under load. Use those as the before/after you
attach to a PR, read by a human, not a build gate.

Run `bench:check` in CI on PRs touching `contentExtractor`, `aiSummaryCleaner`,
`contentDeduplicator`, `src/content`, or the dashboard history panel. Run the
e2e suite nightly or on demand.

### Report retention policy

`bench/reports/` is pruned automatically after every bench run (micro / e2e):

- **Rolling window**: the newest 5 generations (date stamps) are kept.
- **Weekly anchors**: additionally, the newest generation of each ISO week (UTC)
  is kept, so older results survive one-per-week.
- **Generations are deleted as a group**: a date's `.md` / `.html` / `.json`
  always disappear together.
- Files without a date stamp are never pruned. `npm run bench:clean -- --all`
  wipes everything.

Every run mode (default / `--check` / `--update-baseline`) writes the same
`.md` / `.html` / `.json` artifact set. The `.html` file is self-contained
(zero external references) — attach it to a PR or open it directly.

The HTML report includes a **Trend section**: it reads the accumulated
`micro-<date>.json` generations from `bench/reports/` and renders per-bench
sparklines (L-size wall p50/p95/p99, heap, deterministic counters, scaling
exponent) plus first→last values, capped at the newest 26 generations.
Generations with a foreign `schemaVersion` or unparsable JSON are skipped
with a visible count. With fewer than 2 generations a placeholder is shown. The browser
auto-open fires only when ALL of these hold: no `--no-open` flag, not running
in CI, and a TTY is attached (interactive session).

### Updating the baseline

Only for an intentional, reviewed performance change:

```bash
npm run bench:baseline
git add bench/baselines/micro.json
```

### E2E prerequisites

- Run `npm run build` first (needs `dist/chromium-mv3/`).
- Needs headed Chromium; the e2e tests self-skip in headless CI / SSH.
- CPU is fixed at 4× throttle via CDP for machine-independent numbers.
- Lighthouse is an optional dependency; its test skips if not installed
  (`npm i -D lighthouse`).
- Autosave sync cost = the gap between `performance.mark('ow-extract-start')` and
  `'ow-send-ready')` in `src/content/visitReporter.ts`. This window covers the
  **synchronous** extract + cleanse work only — the async send (service-worker
  processing, storage writes) is not included.
- The A/B test disables the content script via
  `localStorage.__ow_bench_disable_cs = '1'` (`src/content/loader.ts`). The
  toggle only exists in a bench build — build with `OW_BENCH=1 npm run build`.
  Production builds compile it out, so page content cannot alter extension
  behavior.

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `bench:check` false-positives | Re-take the baseline (`npm run bench:baseline`). If it persists, a deterministic counter really changed — check the code. |
| Unstable heap deltas | The npm scripts already pass `--expose-gc`; run on an idle machine. |
| Every e2e test skips | Confirm `npm run build` ran and the environment can run headed Chromium. |
| jsdom numbers differ from a real browser | jsdom does not lay out; judge by ratios and baseline deltas, not absolutes. Use the e2e suite for real-browser numbers. |
