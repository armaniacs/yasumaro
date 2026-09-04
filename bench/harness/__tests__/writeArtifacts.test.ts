/**
 * writeArtifacts.test.ts — report artifact set (.md/.json/.html) + trend + prune.
 */
// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeReportArtifacts } from '../writeArtifacts.mjs';

const result = {
  id: 'c2',
  description: 'textscore',
  config: { warmup: 2, measure: 5, sizes: ['S', 'L'] },
  perSize: {
    S: { n: 1, wallMs: { p50: 1, p95: 2, p99: 3 }, heapBytes: { p50: 2048 }, counters: { qsa: 10 } },
    L: { n: 16, wallMs: { p50: 40, p95: 60, p99: 80 }, heapBytes: { p50: 8192 }, counters: { qsa: 160 } },
  },
  scaling: { exponent: 1.02, verdict: 'linear', r2: 0.99 },
};

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bench-artifacts-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('writeReportArtifacts (3-point set)', () => {
  it('writes micro-<stamp>.md / .json / .html and returns their paths', () => {
    const now = new Date('2026-09-04T12:00:00Z');
    const out = writeReportArtifacts({ results: [result], comparison: undefined, reportsDir: dir, now });
    expect(out).toEqual({
      reportPath: join(dir, 'micro-2026-09-04.md'),
      htmlPath: join(dir, 'micro-2026-09-04.html'),
      jsonPath: join(dir, 'micro-2026-09-04.json'),
    });
    expect(existsSync(out.reportPath)).toBe(true);
    expect(existsSync(out.htmlPath)).toBe(true);
    expect(existsSync(out.jsonPath)).toBe(true);
  });

  it('writes a schemaVersion-1 json payload containing the run', () => {
    const now = new Date('2026-09-04T12:00:00Z');
    const comparison = { ok: true, rows: [] };
    const { jsonPath } = writeReportArtifacts({ results: [result], comparison, reportsDir: dir, now });
    const payload = JSON.parse(readFileSync(jsonPath, 'utf8'));
    expect(payload.schemaVersion).toBe(1);
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].id).toBe('c2');
    expect(payload.comparison).toEqual(comparison);
  });
});

describe('writeReportArtifacts (trend injection)', () => {
  it('embeds the current generation in the html Trend section', () => {
    const now = new Date('2026-09-04T12:00:00Z');
    const { htmlPath } = writeReportArtifacts({ results: [result], comparison: undefined, reportsDir: dir, now });
    const html = readFileSync(htmlPath, 'utf8');
    expect(html).toContain('<h2>Trend</h2>');
    expect(html).toContain('2026-09-04');
  });
});

describe('writeReportArtifacts (prune)', () => {
  it('prunes stale generations as a side effect', () => {
    // 6 stale same-week generations (Mon-Sat) + today (Sun) = 7 in one ISO week:
    // rolling 5 keeps the newest 5, same-week drops earn no weekly anchor.
    const stale = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29'];
    for (const stamp of stale) {
      for (const ext of ['md', 'html', 'json']) writeFileSync(join(dir, `micro-${stamp}.${ext}`), 'x');
    }
    const now = new Date('2026-08-30T12:00:00Z'); // Sunday, same ISO week (W35)
    writeReportArtifacts({ results: [result], comparison: undefined, reportsDir: dir, now });
    const kept = readdirSync(dir);
    expect(kept.some((f) => f.startsWith('micro-2026-08-24.'))).toBe(false);
    expect(kept.some((f) => f.startsWith('micro-2026-08-25.'))).toBe(false);
    expect(kept).toContain('micro-2026-08-30.md');
    expect(kept).toContain('micro-2026-08-30.html');
    expect(kept).toContain('micro-2026-08-30.json');
  });
});

describe('writeReportArtifacts (advisory failure)', () => {
  it('warns on stderr without leaking exceptions when the target is not writable', () => {
    const blocker = join(dir, 'file');
    writeFileSync(blocker, 'x');
    const reportsDir = join(blocker, 'reports');
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    let threw = null;
    let out;
    try {
      out = writeReportArtifacts({
        results: [result],
        comparison: undefined,
        reportsDir,
        now: new Date('2026-09-04T12:00:00Z'),
      });
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeNull();
    const warned = spy.mock.calls.some(([chunk]) => String(chunk).includes('WARNING'));
    expect(warned).toBe(true);
    expect(out.reportPath).toBe(join(reportsDir, 'micro-2026-09-04.md'));
  });
});
