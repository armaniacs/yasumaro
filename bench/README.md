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

## Updating the baseline

Only when a performance change is intentional and reviewed:

```bash
npm run bench:baseline
git add bench/baselines/micro.json   # review the diff in the PR
```

## Files

```
bench/
  harness/
    stats.mjs      percentile / trimmedMean / scaling fit / percentDelta
    domEnv.mjs     instrumented jsdom + counters + teardown
    bundle.mjs     esbuild a src/*.ts entry into an importable ESM module
    runner.mjs     bench(id, {setup, run, teardown, sizes, warmup, measure})
    report.mjs     Markdown render + baseline comparison
    cli.mjs        `micro` entry: --filter / --check / --update-baseline / --quick
  micro/           c1-c7 + cleansing, each exporting `definition`
  e2e/             *.bench.ts + _fixtures.ts + server.mjs
  fixtures/_sizes.mjs   synthetic page/content generators (S/M/L)
  baselines/       committed baseline JSON
  reports/         generated, gitignored
  playwright.bench.config.ts
```
