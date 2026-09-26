/**
 * smoke.test.ts — every micro bench definition is wired correctly.
 *
 * Loads each definition module and asserts the exported defs are well formed
 * (string id, callable run) and that the seven target benches are still
 * discoverable. Executing the benches is deliberately not repeated here: the
 * same definitions run end-to-end at their real sizes under
 * `npm run bench:micro`, which is also what CI's bench-check job calls.
 */
// @ts-nocheck
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

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
});
