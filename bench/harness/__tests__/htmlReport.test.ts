/**
 * htmlReport.test.ts — self-contained HTML report shape.
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { renderHtml } from '../htmlReport.mjs';
import { escapeHtml } from '../format.mjs';
import { compareToBaseline } from '../report.mjs';

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

describe('escapeHtml', () => {
  it('escapes HTML-significant characters', () => {
    expect(escapeHtml(`<script>alert("x&y")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;',
    );
  });
});

describe('renderHtml', () => {
  it('includes bench id, description, scaling verdict and a counter chip', () => {
    const html = renderHtml([result]);
    expect(html).toContain('c2');
    expect(html).toContain('textscore');
    expect(html).toContain('linear');
    expect(html).toContain('S.qsa=10');
  });

  it('renders wall numbers as text (chart values are also readable without SVG)', () => {
    const html = renderHtml([result]);
    expect(html).toContain('60'); // L p95
  });

  it('renders baseline comparison rows with status classes', () => {
    const comparison = compareToBaseline(
      { 'c2.L.counter_qsa': 120, 'c2.S.wall_p50': 0.5 },
      { 'c2.L.counter_qsa': 60, 'c2.S.wall_p50': 1 },
    );
    const html = renderHtml([result], { comparison });
    expect(html).toContain('REGRESSED');
    expect(html).toContain('badge v-bad">REGRESSED');
    expect(html).toContain('c2.L.counter_qsa');
    expect(html).toContain('st-regressed');
    expect(html).toContain('st-improved');
  });

  it('shows UNKNOWN badge for malformed comparison without ok field', () => {
    const html = renderHtml([result], { comparison: { rows: [] } });
    expect(html).toContain('UNKNOWN');
    expect(html).toContain('badge v-muted">UNKNOWN');
    expect(html).not.toContain('badge v-bad">REGRESSED');
  });

  it('omits the comparison section and shows a no-baseline badge when comparison is absent', () => {
    const html = renderHtml([result]);
    expect(html).not.toContain('id="comparison"');
    expect(html).toContain('baseline 未登録');
  });

  it('is self-contained: no external src/href references', () => {
    const html = renderHtml([result], { comparison: compareToBaseline({ 'c2.L.counter_qsa': 120 }, { 'c2.L.counter_qsa': 60 }) });
    expect(html).not.toMatch(/\ssrc\s*=\s*["']https?:\/\//);
    expect(html).not.toMatch(/\shref\s*=\s*["']https?:\/\//);
  });

  it('escapes injected bench strings', () => {
    const hostile = { ...result, id: 'c<x>', description: `a<b> & "quoted"` };
    const html = renderHtml([hostile]);
    expect(html).toContain('a&lt;b&gt; &amp; &quot;quoted&quot;');
    expect(html).not.toContain('a<b>');
  });

  it('escapes hostile sizeKey inside SVG title', () => {
    const hostileSizeResult = {
      ...result,
      perSize: { '<x>': { n: 1, wallMs: { p50: 1, p95: 1, p99: 1 }, heapBytes: { p50: 1024 }, counters: {} } },
    };
    const html = renderHtml([hostileSizeResult]);
    expect(html).toContain('<title>&lt;x&gt;');
    expect(html).not.toContain('<title><x>');
  });

  it('marks decorative svg as aria-hidden', () => {
    const html = renderHtml([result]);
    expect(html).toContain('aria-hidden="true"');
  });
});

const HISTORY = {
  skipped: 1,
  generations: [
    { date: '2026-09-02', node: 'v26', generatedAt: '2026-09-02T00:00:00Z', benches: { c2: { wall: { p50: 12, p95: 18, p99: 24 }, heap: 4096, counters: { qsa: 40 }, scalingExponent: 0.8 } } },
    { date: '2026-09-03', node: 'v26', generatedAt: '2026-09-03T00:00:00Z', benches: { c2: { wall: { p50: 10, p95: 14, p99: 17 }, heap: 3800, counters: { qsa: 32 }, scalingExponent: 0.75 } } },
    { date: '2026-09-04', node: 'v26', generatedAt: '2026-09-04T00:00:00Z', benches: { c2: { wall: { p50: 9, p95: 12, p99: 15 }, heap: 3600, counters: { qsa: 30 }, scalingExponent: 0.7 } } },
  ],
};

describe('trend section wire-up (sparse)', () => {
  it('includes the Trend section when history has 2+ generations', () => {
    const html = renderHtml([result], { history: HISTORY });
    expect(html).toContain('id="trend"');
  });

  it('omits the Trend section when history is absent', () => {
    const html = renderHtml([result]);
    expect(html).not.toContain('id="trend"');
  });
});
