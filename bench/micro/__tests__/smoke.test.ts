/**
 * smoke.test.ts — every micro bench definition is wired correctly.
 *
 * Runs each bench at the smallest possible settings (warmup 1, measure 2, one
 * size) and asserts it returns a well-formed result. This is a plumbing check,
 * not a performance assertion — no timing thresholds.
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { bench } from '../../harness/runner.mjs';

const microDir = resolve(__dirname, '..');

async function loadDefs() {
  const files = readdirSync(microDir).filter((f) => f.endsWith('.bench.mjs'));
  const defs = [];
  for (const file of files) {
    const mod = await import(resolve(microDir, file));
    for (const key of Object.keys(mod)) {
      const d = mod[key];
      if (d && typeof d === 'object' && typeof d.id === 'string' && typeof d.run === 'function') {
        defs.push({ file, def: d });
      }
    }
  }
  return defs;
}

describe('micro bench definitions', () => {
  it('discovers at least the seven target benches', async () => {
    const defs = await loadDefs();
    const ids = new Set(defs.map((d) => d.def.id));
    for (const id of ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('runs each bench end-to-end at minimal settings', async () => {
    const defs = await loadDefs();
    // Silence the structured logger's console output during the run.
    const real = { log: console.log, info: console.info, debug: console.debug, warn: console.warn };
    console.log = console.info = console.debug = console.warn = () => {};
    try {
      for (const { def } of defs) {
        const oneSize = [def.sizes?.[0] ?? { key: 'S', n: 1 }];
        const result = await bench(def.id, { ...def, sizes: oneSize, warmup: 1, measure: 2 });
        expect(result.id).toBe(def.id);
        const s = Object.values(result.perSize)[0];
        expect(s.wallMs.p50).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(s.wallMs.p50)).toBe(true);
      }
    } finally {
      Object.assign(console, real);
    }
  }, 120_000);
});
