/**
 * htmlReport.test.ts — self-contained HTML report shape.
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { renderHtml, escapeHtml } from '../htmlReport.mjs';
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
    expect(html).toContain('c2.L.counter_qsa');
    expect(html).toContain('st-regressed');
    expect(html).toContain('st-improved');
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
