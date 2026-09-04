/**
 * report.mjs — render micro-bench results to Markdown and diff them against a
 * committed baseline.
 *
 * Regression policy: a metric fails when it is a "higher-is-worse" metric
 * (wall time, heap, scan counters, scaling exponent) and its value exceeds the
 * baseline by more than `tolerancePct` (default 15%). Improvements never fail.
 * Metrics absent from the baseline are reported as "new", not failures.
 */
import { percentDelta } from './stats.mjs';
import { fmtNum } from './format.mjs';

const DEFAULT_TOLERANCE_PCT = 15;

/**
 * Which metrics gate CI.
 *
 * Only the deterministic counters — querySelectorAll / TreeWalker / cloneNode /
 * encode calls, and the c5/c6 call counters — are gated. For identical code
 * these are identical integers run to run, so a change means an algorithmic
 * change. Wall-clock, heap deltas and the scaling exponent are reported (and
 * are the numbers a PR attaches as before/after) but a shared, unpinned Node
 * process swings them ±100%+ under load, so they cannot break a build.
 *
 * `callback_ms` is a timing value dressed as a counter — excluded.
 */
function gatesRegression(metricKey) {
  if (metricKey.endsWith('.counter_callback_ms')) return false;
  return metricKey.includes('.counter_');
}

/** Deterministic counters have no meaningful noise floor. */
function belowNoiseFloor(_metricKey, _baseline) {
  return false;
}

/** All harness metrics are higher-is-worse today; kept as a hook for future ratio metrics. */
function higherIsWorse(_metricKey) {
  return true;
}

/**
 * @param {Record<string, number>} current   flattened metrics (see runner.flattenMetrics)
 * @param {Record<string, number>} baseline
 * @param {{ tolerancePct?: number }} [opts]
 * @returns {{ ok: boolean, rows: Array<{ metric: string, baseline: number|null, current: number, deltaPct: number|null, status: 'ok'|'regressed'|'improved'|'new' }> }}
 */
export function compareToBaseline(current, baseline, opts = {}) {
  const tol = opts.tolerancePct ?? DEFAULT_TOLERANCE_PCT;
  const rows = [];
  let ok = true;

  for (const [metric, value] of Object.entries(current)) {
    const base = baseline?.[metric];
    if (base === undefined || base === null || Number.isNaN(base)) {
      rows.push({ metric, baseline: null, current: value, deltaPct: null, status: 'new' });
      continue;
    }
    const deltaPct = percentDelta(base, value);
    let status = 'ok';
    const gates = gatesRegression(metric) && !belowNoiseFloor(metric, base);
    if (higherIsWorse(metric) && Number.isFinite(deltaPct) && deltaPct > tol) {
      status = gates ? 'regressed' : 'worse-ungated';
      if (gates) ok = false;
    } else if (Number.isFinite(deltaPct) && deltaPct < -tol) {
      status = 'improved';
    }
    rows.push({ metric, baseline: base, current: value, deltaPct, status });
  }

  return { ok, rows };
}

/**
 * @param {Awaited<ReturnType<import('./runner.mjs').bench>>[]} results
 * @param {{ baseline?: Record<string, number>, comparison?: ReturnType<typeof compareToBaseline>, title?: string }} [opts]
 */
export function renderMarkdown(results, opts = {}) {
  const { comparison, title = 'Micro Benchmark Report' } = opts;
  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Node: ${process.version}`);
  lines.push(`- Benches: ${results.map((r) => r.id).join(', ')}`);
  lines.push('');

  for (const r of results) {
    lines.push(`## ${r.id}${r.description ? ` — ${r.description}` : ''}`);
    lines.push('');
    lines.push(
      `warmup ${r.config.warmup} · measure ${r.config.measure} · scaling exponent ` +
        `**${fmtNum(r.scaling.exponent)}** (${r.scaling.verdict})`,
    );
    lines.push('');
    lines.push('| Size | N | wall p50 (ms) | wall p95 (ms) | wall p99 (ms) | heap p50 (KB) | counters |');
    lines.push('|---|---:|---:|---:|---:|---:|---|');
    for (const [sizeKey, s] of Object.entries(r.perSize)) {
      const counterStr = Object.entries(s.counters)
        .map(([c, v]) => `${c}=${fmtNum(v)}`)
        .join(' ');
      lines.push(
        `| ${sizeKey} | ${s.n} | ${fmtNum(s.wallMs.p50)} | ${fmtNum(s.wallMs.p95)} | ` +
          `${fmtNum(s.wallMs.p99)} | ${fmtNum(s.heapBytes.p50 / 1024)} | ${counterStr} |`,
      );
    }
    lines.push('');
  }

  if (comparison) {
    lines.push('## Baseline comparison');
    lines.push('');
    lines.push(`Result: **${comparison.ok ? 'PASS' : 'REGRESSED'}** (tolerance ±${DEFAULT_TOLERANCE_PCT}%)`);
    lines.push('');
    lines.push('| Metric | Baseline | Current | Δ% | Status |');
    lines.push('|---|---:|---:|---:|---|');
    for (const row of comparison.rows) {
      if (row.status === 'ok') continue; // keep the table focused on movement
      lines.push(
        `| ${row.metric} | ${fmtNum(row.baseline)} | ${fmtNum(row.current)} | ` +
          `${row.deltaPct === null ? '—' : fmtNum(row.deltaPct, '%')} | ${row.status} |`,
      );
    }
    const movedRows = comparison.rows.filter((r) => r.status !== 'ok');
    if (movedRows.length === 0) lines.push('| _(no metric moved beyond tolerance)_ | | | | |');
    lines.push('');
  }

  return lines.join('\n') + '\n';
}

export { DEFAULT_TOLERANCE_PCT };
