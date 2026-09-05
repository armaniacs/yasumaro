/**
 * trendReport.test.ts — Trend section presentation (migrated from htmlReport.test.ts).
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { renderTrendSection, sparkline, trendCss } from '../trendReport.mjs';

const HISTORY = {
  skipped: 1,
  generations: [
    { date: '2026-09-02', node: 'v26', generatedAt: '2026-09-02T00:00:00Z', benches: { c2: { wall: { p50: 12, p95: 18, p99: 24 }, heap: 4096, counters: { qsa: 40 }, scalingExponent: 0.8 } } },
    { date: '2026-09-03', node: 'v26', generatedAt: '2026-09-03T00:00:00Z', benches: { c2: { wall: { p50: 10, p95: 14, p99: 17 }, heap: 3800, counters: { qsa: 32 }, scalingExponent: 0.75 } } },
    { date: '2026-09-04', node: 'v26', generatedAt: '2026-09-04T00:00:00Z', benches: { c2: { wall: { p50: 9, p95: 12, p99: 15 }, heap: 3600, counters: { qsa: 30 }, scalingExponent: 0.7 } } },
  ],
};

describe('renderTrendSection', () => {
  it('renders sparklines and first→last values for 2+ generations', () => {
    const html = renderTrendSection(HISTORY);
    expect(html).toContain('id="trend"');
    expect(html).toContain('polyline');
    expect(html).toContain('p50: 12.000→9.000ms');
    expect(html).toContain('heap: 4.000→3.516KiB');
    expect(html).toContain('qsa: 40.000→30.000');
    expect(html).toContain('2026-09-02');
  });

  it('renders the 1-generation placeholder without sparklines', () => {
    const html = renderTrendSection({ skipped: 0, generations: [HISTORY.generations[2]] });
    expect(html).toContain('id="trend"');
    expect(html).toContain('1 世代のみ');
    expect(html).not.toContain('polyline');
  });

  it('returns empty string when history is absent or malformed', () => {
    expect(renderTrendSection(undefined)).toBe('');
    expect(renderTrendSection({})).toBe('');
    expect(renderTrendSection({ generations: [] })).toBe('');
  });

  it('notes skipped generations', () => {
    expect(renderTrendSection(HISTORY)).toContain('スキップ: 1');
  });

  it('stays self-contained (no external references)', () => {
    const html = renderTrendSection(HISTORY);
    expect(html).not.toMatch(/\ssrc\s*=\s*["']https?:\/\//);
    expect(html).not.toMatch(/\shref\s*=\s*["']https?:\/\//);
  });
});

describe('sparkline', () => {
  it('returns empty string with fewer than 2 plottable points', () => {
    expect(sparkline({ p50: [1] })).toBe('');
    expect(sparkline({ p50: [null, undefined] })).toBe('');
  });
});

describe('trendCss', () => {
  it('exposes the trend class rules moved out of htmlReport', () => {
    expect(trendCss).toContain('.sparkline .trend-line-p50');
    expect(trendCss).toContain('.trend-vals');
  });
});
