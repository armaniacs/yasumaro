/**
 * report.test.ts — baseline comparison and Markdown shape.
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { compareToBaseline, renderMarkdown } from '../report.mjs';

describe('compareToBaseline', () => {
  const baseline = {
    'c1.L.wall_p95': 100,
    'c1.L.counter_qsa': 200,
    'c1.scaling_exponent': 1.0,
  };

  it('passes when within tolerance', () => {
    const { ok, rows } = compareToBaseline(
      { 'c1.L.wall_p95': 114, 'c1.L.counter_qsa': 200, 'c1.scaling_exponent': 1.05 },
      baseline,
    );
    expect(ok).toBe(true);
    expect(rows.find((r) => r.metric === 'c1.L.wall_p95').status).toBe('ok');
  });

  it('does not gate the scaling exponent (diagnostic only)', () => {
    const { ok, rows } = compareToBaseline({ 'c1.scaling_exponent': 1.4 }, baseline);
    expect(ok).toBe(true);
    expect(rows[0].status).toBe('worse-ungated');
  });

  it('fails when a gated counter regresses past +15%', () => {
    const { ok, rows } = compareToBaseline({ 'c1.L.counter_qsa': 232 }, baseline);
    expect(ok).toBe(false);
    expect(rows[0].status).toBe('regressed');
    expect(rows[0].deltaPct).toBeCloseTo(16, 5);
  });

  it('marks a >15% counter improvement without failing', () => {
    const { ok, rows } = compareToBaseline({ 'c1.L.counter_qsa': 100 }, baseline);
    expect(ok).toBe(true);
    expect(rows[0].status).toBe('improved');
  });

  it('does not gate wall-clock, heap or scaling (reported, never a failure)', () => {
    const { ok, rows } = compareToBaseline(
      { 'c1.L.wall_p95': 999, 'c1.L.heap_p50': 999, 'c1.L.wall_p50': 999 },
      { 'c1.L.wall_p95': 100, 'c1.L.heap_p50': 100, 'c1.L.wall_p50': 100 },
    );
    expect(ok).toBe(true);
    expect(rows.every((r) => r.status === 'worse-ungated')).toBe(true);
  });

  it('does not gate callback_ms (timing counter)', () => {
    const { ok, rows } = compareToBaseline(
      { 'c5.L.counter_callback_ms': 5 },
      { 'c5.L.counter_callback_ms': 1 },
    );
    expect(ok).toBe(true);
    expect(rows[0].status).toBe('worse-ungated');
  });

  it('reports unknown metrics as new, not failures', () => {
    const { ok, rows } = compareToBaseline({ 'c9.new.metric': 5 }, baseline);
    expect(ok).toBe(true);
    expect(rows[0].status).toBe('new');
  });

  it('exactly +15% on a gated counter is still ok (strictly greater fails)', () => {
    const { ok } = compareToBaseline({ 'c1.L.counter_qsa': 230 }, baseline);
    expect(ok).toBe(true);
  });
});

describe('renderMarkdown', () => {
  const result = {
    id: 'c2',
    description: 'textscore',
    config: { warmup: 5, measure: 30, sizes: ['S', 'L'] },
    perSize: {
      S: { n: 1, wallMs: { p50: 1, p95: 2, p99: 3 }, heapBytes: { p50: 2048 }, counters: { qsa: 10 } },
      L: { n: 16, wallMs: { p50: 40, p95: 60, p99: 80 }, heapBytes: { p50: 8192 }, counters: { qsa: 160 } },
    },
    scaling: { exponent: 1.02, verdict: 'linear', r2: 0.99 },
  };

  it('includes bench id, scaling verdict and a size row', () => {
    const md = renderMarkdown([result]);
    expect(md).toContain('## c2 — textscore');
    expect(md).toContain('linear');
    expect(md).toContain('| L | 16 |');
  });

  it('renders a baseline comparison section when provided', () => {
    const comparison = compareToBaseline(
      { 'c2.L.counter_qsa': 120 },
      { 'c2.L.counter_qsa': 60 },
    );
    const md = renderMarkdown([result], { comparison });
    expect(md).toContain('## Baseline comparison');
    expect(md).toContain('REGRESSED');
    expect(md).toContain('c2.L.counter_qsa');
  });
});
