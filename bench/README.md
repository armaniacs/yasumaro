# Benchmark harness

Performance measurement for the extension's hot paths. Backs the optimization
PBIs `pbi/2026-09-04-02` … `08` (see `pbi/2026-09-04-00-backlog-perf.md`): each
one takes a before/after here and attaches the diff to its PR.

Two layers:

| Layer | Where | Runs in | What it measures |
|-------|-------|---------|------------------|
| **micro** | `bench/micro/*.bench.mjs` | Node + jsdom, no network | wall-clock P50/P95/P99, DOM scan counts, heap deltas, scaling exponent |
| **e2e** | `bench/e2e/*.bench.ts` | headed Chromium + built extension | autosave end-to-end time, Long Tasks/TBT, memory, Lighthouse, SW cold start |

## Quick start

```bash
npm run bench:micro                     # all micro benches -> bench/reports/micro-<date>.md
npm run bench:micro -- --filter c2,c7    # subset (id prefix match)
npm run bench:micro -- --quick           # warmup 2 / measure 5 (smoke, ~20s)

npm run build && npm run bench:e2e       # e2e suite (needs dist/chromium-mv3)

npm run bench:baseline                   # overwrite bench/baselines/micro.json
npm run bench:check                      # compare to baseline, exit 1 on regression (CI)
```

The generated HTML report includes a **Trend** section: the persisted
`micro-<date>.json` generations are aggregated (`bench/harness/trend.mjs`) into
per-bench sparklines (L-size wall p50/p95/p99, heap, counters, scaling exponent)
with first→last values, capped at the newest 26 generations. Foreign
`schemaVersion` or unparsable files are skipped with a visible count.

Micro benches use `--expose-gc` (wired into the npm scripts) so heap deltas are
stable. Run them on an otherwise-idle machine.

## Micro bench map

| id | Target PBI | Fixture | Primary signal |
|----|-----------|---------|----------------|
| `c1` | 04 byte accounting | news-article | `encode` count, heap p50 (non-diagnostic path) |
| `c2` | 03 textscore precompute | spa-heavy | `treeWalker` count, wall p95 |
| `c3` / `c3-shadow` | 05 querySelectorAllDeep | news / shadow-dom | `qsa` count (deep recursion) |
| `c4` | 06 cloneNode dedup | news-article | `clone` count, heap p50 |
| `c5` | 02 content-script polling | synthetic | `schedule_calls` over N virtual seconds |
| `c6` | 07 dashboard query cache | fake query/storage | `query_calls`, `storage_set` for an interaction sequence |
| `c7` | 08 dedup O(N²) | long-text | wall p95, **scaling exponent** (should fall from ~2 toward ~1) |
| `cleansing` | — (ex `benchmark-cleansing.mjs`) | synthetic | wall p95, `qsa` / `treeWalker` |

Sizes S/M/L map to a per-bench multiplier (`n`). The runner fits
`time ≈ c·Nᵏ` across the three sizes and reports `k` plus a verdict
(`linear` / `super-linear` / `quadratic` / …).

## Metrics & how they're collected

- **wall-clock** — `performance.now()` diffs; warmup 5 + measure 30 by default;
  P50/P95/P99 via linear-interpolated percentile (`bench/harness/stats.mjs`).
- **DOM scan counters** — `bench/harness/domEnv.mjs` wraps `querySelectorAll`,
  `createTreeWalker` traversal, `cloneNode(true)`, and layout-coupled getters
  (`getComputedStyle`, `getBoundingClientRect`; jsdom lacks `innerText`/`offset*`
  so those are not instrumentable here). Every wrap is restored on `teardown()`.
  `createTreeWalker` counts only the measured module's traversals: jsdom
  implements `querySelectorAll` on top of `@asamuzakjp/dom-selector`, whose
  fallback path drives its own TreeWalker through the same public method, so
  engine-internal creations are skipped — they scale with the selectors a rule
  set uses, not with the module's DOM walking (measured 2026-10-12: a cleansing
  refactor moved this counter +1813% while the module made 0 TreeWalker calls
  and wall moved ~+23%).
- **heap deltas** — `process.memoryUsage().heapUsed` before/after each measured
  iteration, with a forced `gc()` beforehand when `--expose-gc` is set.
- **scaling exponent** — least-squares fit on `log(N)` vs `log(P50)`.
- **custom counters** — `c5` (`schedule_calls`, `callback_ms`) and `c6`
  (`query_calls`, `storage_get/set`) expose their own via `snapshotCounters()`.

### e2e

- **autosave latency** — content script emits `performance.mark('ow-extract-start')`
  and `'ow-send-ready')` around the synchronous extract+cleanse in
  `src/content/visitReporter.ts`; `bench/e2e/autosave-latency.bench.ts` reads the
  gap via `performance.getEntriesByName`.
- **Long Tasks / TBT** — `PerformanceObserver({ type: 'longtask' })` injected via
  `addInitScript`, summed.
- **CPU throttle** — every e2e bench applies `Emulation.setCPUThrottlingRate: 4`
  (CDP) so numbers are comparable across machines.
- **Lighthouse** — `bench/e2e/lighthouse.bench.ts`; skips cleanly if `lighthouse`
  is not installed.
- **A/B** — `content-script-impact.bench.ts` compares load with the content
  script active vs. an early-return control (`localStorage.__ow_bench_disable_cs`).
  The control only exists in a bench build (`OW_BENCH=1 npm run build`);
  production builds compile the check out.
- e2e benches write `bench/reports/e2e-*-<date>.json` (not diffed by
  `bench:check` yet — inspect manually or extend `report.mjs`).

## Regression detection (CI)

`npm run bench:check` compares the current run to `bench/baselines/micro.json`
and **fails only on the deterministic counters** — `querySelectorAll` /
TreeWalker / `cloneNode` / `encode` calls and the `c5`/`c6` call counters. For
identical code these are identical integers every run, so a change past +15%
means an algorithmic change worth reviewing.

Wall-clock, heap deltas and the scaling exponent are **reported but not gated**:
a shared, unpinned Node process swings them ±100% under load, so they would
produce false CI failures. They are the numbers you attach to a PR as
before/after (`bench:micro -- --filter cN`), read by a human, not a build.

Metrics missing from the baseline are reported as `new`, never as failures.
Improvements never fail. Ungated movement shows as `worse-ungated` in the report.

Recommended: run `bench:check` in CI on PRs that touch `src/utils/contentExtractor`,
`src/utils/aiSummaryCleaner`, `src/utils/contentDeduplicator`, `src/content`, or
`src/dashboard/panels/asyncData`. Run the e2e suite nightly or on demand, not
per-PR.

### The exception: unit-suite wall time

`npm run test:perf` (`scripts/test-perf/report.mjs`) gates the **test suite's own**
execution cost against `bench/baselines/test-perf.budget.json`, and it runs in
the `validate` CI job in place of plain `npm test`. It deliberately does not
follow the "wall is never gated" rule above, for one reason: the suite's cost is
per-file fixed overhead — a fork, an environment, a transform and the shared
setup file per file — and nothing else in the repository holds that down. If
wall is ungated there too, the cost has no gate at all.

What it gates, and what it does not:

- **Gated: file count only.** That is the quantity the per-file fixed cost
  actually scales with, and the only machine-independent one. The budget file
  splits its keys into `gates` and `reference` to make the distinction explicit.
- **Advisory, printed but never failing:** the summed / p95 / top-10 test-body
  times, and wall. Both are machine- and worker-count-dependent — 76.9s at 6
  workers, 184s at 3, 303s at 2 on one 8-core box, and CI is a 4-vCPU runner at a
  pinned 3 workers. A checked-in threshold for either would be so loose it
  catches nothing or so tight it fails on a routine runner difference. Since
  `build` declares `needs: validate`, that failure would also block the build
  artifact, so the times are shown for a human rather than enforced.
- **The JSON reporter cannot measure fixed cost.** `startTime`/`endTime` bracket
  the test phase only — measured, summed span 84.67ms against summed assertion
  durations 84.07ms — so every per-file number here excludes environment,
  transform, import and the shared setup file. File count is the gate that
  stands in for that cost, which is also why the fixed cost has no time
  threshold: nothing measurable could hold it.
- Load average is sampled **before** the run and decides whether to judge at
  all: above the core count the gate prints "machine is busy" and exits 0
  without evaluating, though it still enforces file count. A *delta* between
  before and after must not be used for this — a suite that saturates every core
  raises the 1-minute average by roughly the worker count, so the literal "delta
  >= 1" rule discards every measurement (measured 3.0 -> 14.3 from an idle
  start) and the gate never reaches a verdict.

Raise the budget only for a deliberate, reviewed change — never to silence a
regression. `make test-perf` runs the same gate locally.

## Updating the baseline

Only when a performance change is intentional and reviewed:

```bash
npm run bench:baseline
git add bench/baselines/micro.json   # review the diff in the PR
```

Every movement of a CI-gated counter must carry its reason — see
[ベースライン再導出の記録](#ベースライン再導出の記録--baseline-re-derivation-record).

## ベースライン再導出の記録 / Baseline re-derivation record

`bench/baselines/micro.json` は CI 回帰ゲート（`bench/harness/report.mjs` の
`gatesRegression`: `*.counter_*`、`counter_callback_ms` 除く）の物差しである。
同一コードならこれらのカウンタは毎回同一の整数になるため、値の変更は
アルゴリズム変更の契約変更にあたる。**このファイルを再導出・更新するときは、
動かしたゲート対象カウンタとその理由をコミット本文に併記し、
`bench/__tests__/microBaselineCounters.test.ts` のスナップショットを同じコミットで
更新する。** wall / heap / scaling exponent（非ゲートの reference 値）だけが
変わる再導出でも、その旨を書く。理由の確認なしに値を変えない。

### 2026-10-12 / commit ac1c43a8 — TreeWalker カウンタの汚染除去

`domEnv.mjs` の `createTreeWalker` パッチが jsdom のセレクタエンジン
（`@asamuzakjp/dom-selector`）内部の走査を数えなくなったため、カウンタの意味が
変わり `npm run bench:baseline` で全件を再導出した。前回のベースラインは
2026-09-07（530b7283）で、その間（約 5 週間）に計測対象モジュールとハーネスに
変更が蓄積していたため、除外パッチの影響以外にもゲート対象カウンタが再設定されている。
コミット本文は TreeWalker の除外だけを説明しており、以下のようなその他のカウンタ変動の
理由は記録されていなかった。本節はその補記である。

| counter（S / M / L） | 旧 (2026-09-07) | 新 (2026-10-12) | 区分 |
|---|---|---|---|
| `c1.*.counter_encode` | 8 / 8 / 8 | 2 / 2 / 2 | 除外パッチでは説明できない変動 |
| `c1.*.counter_treeWalker` | 2385 / 9129 / 36105 | 25 / 97 / 385 | 除外パッチ（エンジン走査を除外） |
| `c2.*.counter_treeWalker` | 0 / 0 / 0 | 173 / 692 / 2768 | 旧基準時の計測対象コードとの差 |
| `c3.*.counter_qsa` | 2 / 2 / 2 | 1 / 1 / 1 | 除外パッチでは説明できない変動 |
| `c3.*.counter_treeWalker` | 131 / 483 / 1891 | 64 / 240 / 944 | 除外パッチ |
| `c3-shadow.*.counter_qsa` | 6 / 18 / 66 | 3 / 9 / 33 | 除外パッチでは説明できない変動 |
| `c3-shadow.*.counter_treeWalker` | 113 / 429 / 1693 | 39 / 149 / 589 | 除外パッチ |
| `c4.*.counter_treeWalker` | 2385 / 9129 / 36105 | 25 / 97 / 385 | 除外パッチ |
| `c5.*.counter_schedule_calls` | 11 / 31 / 121 | 1 / 1 / 1 | 除外パッチでは説明できない変動 |
| `c6.*.counter_query_calls` | 7 / 21 / 56 | 4 / 4 / 4 | 除外パッチでは説明できない変動 |
| `c6.*.counter_storage_set` | 2 / 6 / 16 | 0 / 0 / 0 | 除外パッチでは説明できない変動 |
| `cleansing.*.counter_treeWalker` | 3150 / 16053 / 32325 | 0 / 0 / 0 | measured code は TreeWalker 未使用（probe 実測） |

wall / heap / scaling exponent と `f3.*` も同時に再測定されているが、これらは
非ゲートの reference 値である。現行のゲート対象値は
`bench/__tests__/microBaselineCounters.test.ts`（2026-10-15 追加）に pin されている。
このテストが赤いときは値をその場で書き換えず、まず上表の経緯と変動理由を確認する。

## Files

```
bench/
  harness/
    stats.mjs      percentile / trimmedMean / scaling fit / percentDelta
    domEnv.mjs     instrumented jsdom + counters + teardown
    bundle.mjs     esbuild a src/*.ts entry into an importable ESM module
    runner.mjs     bench(id, {setup, run, teardown, sizes, warmup, measure})
    format.mjs     shared number formatting for both renderers
    report.mjs     Markdown render + baseline comparison
    htmlReport.mjs self-contained HTML render (latest + baseline + trend)
    trend.mjs      history aggregation from persisted micro-<date>.json
    clean.mjs      reports retention (rolling 5 generations + weekly anchors)
    openReport.mjs desktop auto-open for the generated HTML report
    cli.mjs        `micro` entry: --filter / --check / --update-baseline / --quick / --no-open
  micro/           c1-c7 + cleansing, each exporting `definition`
  e2e/             *.bench.ts + _fixtures.ts + server.mjs
  fixtures/_sizes.mjs   synthetic page/content generators (S/M/L)
  baselines/       committed baseline JSON
  reports/         generated, gitignored
  playwright.bench.config.ts
```
