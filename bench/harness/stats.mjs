/**
 * stats.mjs — pure statistics helpers for the benchmark harness.
 *
 * No DOM, no timers, no I/O. Every function is deterministic given its input
 * so the harness unit tests can pin exact values.
 */

/**
 * @param {number[]} values
 * @returns {number[]} ascending copy
 */
function sortedCopy(values) {
  return [...values].sort((a, b) => a - b);
}

/** Median (p50). Empty input returns NaN. */
export function median(values) {
  return percentile(values, 50);
}

/**
 * Linear-interpolated percentile, matching the "R-7" / Excel PERCENTILE.INC
 * convention so results line up with common tooling.
 *
 * @param {number[]} values
 * @param {number} p  0..100
 */
export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return NaN;
  if (values.length === 1) return values[0];
  const sorted = sortedCopy(values);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/** Arithmetic mean. Empty input returns NaN. */
export function mean(values) {
  if (!values || values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n-1). Fewer than 2 samples returns 0. */
export function stddev(values) {
  if (!values || values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Trim a fraction from each tail, then take the mean of what remains.
 * Guards against a single GC pause or a cold sample dominating the average.
 *
 * @param {number[]} values
 * @param {number} trimFraction  fraction removed from EACH end (default 0.1)
 */
export function trimmedMean(values, trimFraction = 0.1) {
  if (!values || values.length === 0) return NaN;
  if (values.length < 3 || trimFraction <= 0) return mean(values);
  const sorted = sortedCopy(values);
  const cut = Math.floor(sorted.length * trimFraction);
  const kept = cut > 0 ? sorted.slice(cut, sorted.length - cut) : sorted;
  return mean(kept.length > 0 ? kept : sorted);
}

/**
 * Estimate the scaling exponent k in  time ≈ c * N^k  from measurements at
 * several input sizes, via a least-squares fit on log(N) vs log(time).
 *
 * Used to tell O(N) apart from O(N^2): a fit near 1.0 is linear, near 2.0 is
 * quadratic. Needs at least two distinct sizes with positive timings.
 *
 * @param {{ n: number, time: number }[]} points
 * @returns {{ exponent: number, verdict: string, r2: number }}
 */
export function scalingExponent(points) {
  const usable = (points ?? []).filter(
    (p) => Number.isFinite(p.n) && p.n > 0 && Number.isFinite(p.time) && p.time > 0,
  );
  const distinctN = new Set(usable.map((p) => p.n));
  if (usable.length < 2 || distinctN.size < 2) {
    return { exponent: NaN, verdict: 'insufficient-data', r2: NaN };
  }

  const xs = usable.map((p) => Math.log(p.n));
  const ys = usable.map((p) => Math.log(p.time));
  const xBar = mean(xs);
  const yBar = mean(ys);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxx += (xs[i] - xBar) ** 2;
    sxy += (xs[i] - xBar) * (ys[i] - yBar);
    syy += (ys[i] - yBar) ** 2;
  }
  const exponent = sxx === 0 ? NaN : sxy / sxx;
  const r2 = sxx === 0 || syy === 0 ? NaN : (sxy * sxy) / (sxx * syy);

  return { exponent, verdict: classifyExponent(exponent), r2 };
}

/** @param {number} k */
export function classifyExponent(k) {
  if (!Number.isFinite(k)) return 'unknown';
  if (k < 0.5) return 'sub-linear';
  if (k < 1.35) return 'linear';        // O(N), with slack for measurement noise
  if (k < 1.75) return 'super-linear';  // O(N log N) territory
  if (k < 2.5) return 'quadratic';      // O(N^2)
  return 'polynomial-or-worse';
}

/**
 * Summarise a raw list of per-iteration measurements into the shape the
 * report and baseline comparison consume.
 *
 * @param {number[]} samples
 * @param {number} [trimFraction]
 */
export function summarize(samples, trimFraction = 0.1) {
  return {
    count: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    mean: mean(samples),
    trimmedMean: trimmedMean(samples, trimFraction),
    stddev: stddev(samples),
    min: samples.length ? Math.min(...samples) : NaN,
    max: samples.length ? Math.max(...samples) : NaN,
  };
}

/**
 * Percent change from baseline to current. Positive = slower/larger.
 * A zero baseline with a non-zero current is reported as Infinity.
 *
 * @param {number} baseline
 * @param {number} current
 */
export function percentDelta(baseline, current) {
  if (!Number.isFinite(baseline) || !Number.isFinite(current)) return NaN;
  if (baseline === 0) return current === 0 ? 0 : Infinity;
  return ((current - baseline) / baseline) * 100;
}
