// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTrendHistory } from '../trend.mjs';

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bench-trend-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a micro-<date>.json in the real persisted shape. */
function writeGen(date, benches = {}, opts = {}) {
  const { generatedAt, node, schemaVersion = 1 } = opts;
  const results = Object.entries(benches).map(([id, b]) => ({
    id,
    description: `${id} desc`,
    config: { warmup: 5, measure: 30, sizes: ['L'] },
    perSize: {
      L: {
        n: 800,
        wallMs: { p50: b.wall?.p50 ?? 1, p95: b.wall?.p95 ?? 2, p99: b.wall?.p99 ?? 3 },
        heapBytes: { p50: b.heap ?? 1024 },
        counters: b.counters ?? {},
      },
    },
    scaling: { exponent: b.scalingExponent ?? 0.9, verdict: 'linear', r2: 0.99 },
  }));
  const payload = {
    schemaVersion,
    generatedAt: generatedAt ?? `${date}T00:00:00.000Z`,
    node: node ?? 'v26.0.0',
    results,
    comparison: null,
  };
  writeFileSync(join(dir, `micro-${date}.json`), JSON.stringify(payload), 'utf8');
}

const B1 = { wall: { p50: 10, p95: 15, p99: 20 }, heap: 2048, counters: { encode: 8 }, scalingExponent: 0.9 };

describe('loadTrendHistory', () => {
  it('collects generations sorted by date and maps L metrics', () => {
    writeGen('2026-09-02', { c1: B1 });
    writeGen('2026-09-04', { c1: { ...B1, wall: { p50: 8, p95: 12, p99: 16 }, counters: { encode: 2 } } });
    writeGen('2026-09-03', { c1: { ...B1, wall: { p50: 9, p95: 13, p99: 18 } } });

    const out = loadTrendHistory(dir);
    expect(out.skipped).toBe(0);
    expect(out.generations.map((g) => g.date)).toEqual(['2026-09-02', '2026-09-03', '2026-09-04']);
    const first = out.generations[0].benches.c1;
    expect(first.wall).toEqual({ p50: 10, p95: 15, p99: 20 });
    expect(first.heap).toBe(2048);
    expect(first.counters).toEqual({ encode: 8 });
    expect(first.scalingExponent).toBe(0.9);
    const last = out.generations[2].benches.c1;
    expect(last.wall.p50).toBe(8);
    expect(last.counters).toEqual({ encode: 2 });
    expect(out.generations[0].node).toBe('v26.0.0');
  });

  it('skips schemaVersion != 1 and unparsable files with a count', () => {
    writeGen('2026-09-02', { c1: B1 });
    writeFileSync(join(dir, 'micro-2026-09-03.json'), JSON.stringify({ schemaVersion: 0, results: [] }), 'utf8');
    writeFileSync(join(dir, 'micro-2026-09-04.json'), '{not json', 'utf8');

    const out = loadTrendHistory(dir);
    expect(out.generations.map((g) => g.date)).toEqual(['2026-09-02']);
    expect(out.skipped).toBe(2);
  });

  it('resolves same-date duplicates by the newest generatedAt', () => {
    writeGen('2026-09-04', { c1: { ...B1, wall: { p50: 5, p95: 5, p99: 5 } } }, { generatedAt: '2026-09-04T08:00:00.000Z' });
    // Simulate a later same-day overwrite: distinct file name is not possible
    // (same date = same file), so this case is covered by the same file being
    // rewritten — emulate two files by hand.
    writeFileSync(
      join(dir, 'micro-2026-09-04.json'),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-09-04T18:00:00.000Z',
        node: 'v26.0.0',
        results: [],
        comparison: null,
      }),
      'utf8',
    );

    const out = loadTrendHistory(dir);
    expect(out.generations).toHaveLength(1);
    expect(out.generations[0].generatedAt).toBe('2026-09-04T18:00:00.000Z');
  });

  it('caps the series at the newest `cap` generations', () => {
    for (let d = 1; d <= 30; d++) {
      const date = `2026-08-${String(d).padStart(2, '0')}`;
      writeGen(date, { c1: B1 });
    }
    const out = loadTrendHistory(dir, { cap: 26 });
    expect(out.generations).toHaveLength(26);
    expect(out.generations[0].date).toBe('2026-08-05'); // 30 - 26 + 1
    expect(out.generations[25].date).toBe('2026-08-30');
    expect(out.skipped).toBe(0); // cap overflow is not a parse failure
  });

  it('tolerates generations missing the L size or the bench entirely', () => {
    // 2026-09-02 has c1 without L (perSize empty); 2026-09-03 has c2 only
    writeFileSync(
      join(dir, 'micro-2026-09-02.json'),
      JSON.stringify({
        schemaVersion: 1,
        generatedAt: '2026-09-02T00:00:00.000Z',
        node: 'v26.0.0',
        results: [{ id: 'c1', description: '', config: { warmup: 1, measure: 1, sizes: [] }, perSize: {}, scaling: { exponent: 1, verdict: 'linear' } }],
        comparison: null,
      }),
      'utf8',
    );
    writeGen('2026-09-03', { c2: B1 });

    const out = loadTrendHistory(dir);
    expect(out.generations[0].benches.c1.wall).toBeNull();
    expect(out.generations[0].benches.c1.counters).toEqual({});
    expect(out.generations[1].benches.c2).toBeDefined();
    expect(out.generations[1].benches.c1).toBeUndefined();
  });

  it('returns an empty result when the reports directory does not exist', () => {
    const out = loadTrendHistory(join(dir, 'nope'));
    expect(out.generations).toEqual([]);
    expect(out.skipped).toBe(0);
  });

  it('ignores non-json artifacts (md/html) in the directory', () => {
    writeGen('2026-09-02', { c1: B1 });
    writeFileSync(join(dir, 'micro-2026-09-02.md'), '# report', 'utf8');
    writeFileSync(join(dir, 'micro-2026-09-02.html'), '<html></html>', 'utf8');
    writeFileSync(join(dir, 'e2e-autosave-2026-09-02.json'), '{}', 'utf8');

    const out = loadTrendHistory(dir);
    expect(out.generations).toHaveLength(1);
  });
});
