/**
 * runner.mjs — the micro-benchmark driver.
 *
 * A bench definition supplies `setup(size) -> context`, `run(context)` (the
 * measured unit), and optional `teardown(context)`. The runner does warmup +
 * measured iterations per size, records wall-clock and heap deltas, reads back
 * whatever counters the bench exposes on its context, and fits a scaling
 * exponent across sizes.
 *
 * Timing uses `performance.now()` diffs (mark/measure are also emitted for any
 * external Performance Timeline consumer). No jsdom is created here — a bench
 * that needs a DOM builds one in `setup` via bench/harness/domEnv.mjs.
 */
import { performance } from 'node:perf_hooks';
import { summarize, scalingExponent } from './stats.mjs';

/** @typedef {{ counters?: Record<string, number>, resetCounters?: () => void, snapshotCounters?: () => Record<string, number> }} BenchContext */

const DEFAULT_SIZES = [
  { key: 'S', n: 1 },
  { key: 'M', n: 4 },
  { key: 'L', n: 16 },
];

function maybeGc() {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc();
  }
}

/**
 * @param {string} id
 * @param {{
 *   description?: string,
 *   sizes?: { key: string, n: number }[],
 *   warmup?: number,
 *   measure?: number,
 *   setup: (size: { key: string, n: number }) => (BenchContext | Promise<BenchContext>),
 *   run: (ctx: BenchContext) => (unknown | Promise<unknown>),
 *   teardown?: (ctx: BenchContext) => (unknown | Promise<unknown>),
 *   counters?: string[],
 * }} def
 */
export async function bench(id, def) {
  const {
    description = '',
    sizes = DEFAULT_SIZES,
    warmup = 5,
    measure = 30,
    setup,
    run,
    teardown,
    counters = ['qsa', 'treeWalker', 'reflow', 'clone'],
  } = def;

  if (typeof setup !== 'function' || typeof run !== 'function') {
    throw new Error(`bench "${id}" requires setup() and run() functions`);
  }

  const perSize = {};
  const scalingPoints = [];

  for (const size of sizes) {
    const timings = [];
    const heapDeltas = [];
    /** @type {Record<string, number[]>} */
    const counterSamples = Object.fromEntries(counters.map((c) => [c, []]));

    // Warmup — build/exercise/discard, no recording. Lets the JIT settle.
    for (let i = 0; i < warmup; i++) {
      const ctx = await setup(size);
      await run(ctx);
      if (teardown) await teardown(ctx);
    }

    for (let i = 0; i < measure; i++) {
      const ctx = await setup(size);
      if (typeof ctx?.resetCounters === 'function') ctx.resetCounters();

      maybeGc();
      const heapBefore = process.memoryUsage().heapUsed;
      const markStart = `${id}:${size.key}:${i}:start`;
      const markEnd = `${id}:${size.key}:${i}:end`;

      performance.mark(markStart);
      const t0 = performance.now();
      await run(ctx);
      const t1 = performance.now();
      performance.mark(markEnd);
      try {
        performance.measure(`${id}:${size.key}:${i}`, markStart, markEnd);
      } catch {
        /* measure is advisory */
      }
      const heapAfter = process.memoryUsage().heapUsed;

      timings.push(t1 - t0);
      heapDeltas.push(heapAfter - heapBefore);

      const snap =
        typeof ctx?.snapshotCounters === 'function'
          ? ctx.snapshotCounters()
          : (ctx?.counters ?? {});
      for (const c of counters) {
        counterSamples[c].push(Number(snap[c] ?? 0));
      }

      try {
        performance.clearMarks(markStart);
        performance.clearMarks(markEnd);
        performance.clearMeasures(`${id}:${size.key}:${i}`);
      } catch {
        /* noop */
      }

      if (teardown) await teardown(ctx);
    }

    const wall = summarize(timings);
    const heap = summarize(heapDeltas);
    /** @type {Record<string, number>} */
    const counterMedians = {};
    for (const c of counters) {
      const s = summarize(counterSamples[c]);
      counterMedians[c] = s.p50;
    }

    perSize[size.key] = {
      n: size.n,
      wallMs: wall,
      heapBytes: heap,
      counters: counterMedians,
    };
    scalingPoints.push({ n: size.n, time: wall.p50 });
  }

  return {
    id,
    description,
    generatedAt: new Date().toISOString(),
    config: { warmup, measure, sizes: sizes.map((s) => s.key) },
    perSize,
    scaling: scalingExponent(scalingPoints),
  };
}

/**
 * Flatten a bench result into a `{ "<id>.<size>.<metric>": number }` map for
 * baseline storage and regression comparison.
 *
 * @param {Awaited<ReturnType<typeof bench>>} result
 */
export function flattenMetrics(result) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [sizeKey, s] of Object.entries(result.perSize)) {
    out[`${result.id}.${sizeKey}.wall_p50`] = s.wallMs.p50;
    out[`${result.id}.${sizeKey}.wall_p95`] = s.wallMs.p95;
    out[`${result.id}.${sizeKey}.wall_p99`] = s.wallMs.p99;
    out[`${result.id}.${sizeKey}.heap_p50`] = s.heapBytes.p50;
    for (const [c, v] of Object.entries(s.counters)) {
      out[`${result.id}.${sizeKey}.counter_${c}`] = v;
    }
  }
  if (Number.isFinite(result.scaling.exponent)) {
    out[`${result.id}.scaling_exponent`] = result.scaling.exponent;
  }
  return out;
}
