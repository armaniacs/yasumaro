/**
 * layer-boundary.test.ts
 * Mechanical check that the neutral wire layer has no static runtime edge
 * to background. `import type` is allowed; dynamic import is out of scope.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STATIC_RUNTIME_EDGE = /^(?:import|export)\s+(?:\{|\*)[^;]*?from\s+'\.\.\/background[^']*'/m;

function collectMessagingSources(root: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
        const full = join(entry.parentPath, entry.name);
        if (full.includes('__tests__')) continue;
        out.push(full);
    }
    return out.sort();
}

describe('messaging layer boundary', () => {
    it('has no static runtime import from background', () => {
        const root = new URL('..', import.meta.url);
        const files = collectMessagingSources(root.pathname);
        expect(files.length).toBeGreaterThan(0);
        const violations = files.filter((file) => STATIC_RUNTIME_EDGE.test(readFileSync(file, 'utf8')));
        expect(violations).toEqual([]);
    });

    it('regex rejects runtime imports but allows import type', () => {
        expect(STATIC_RUNTIME_EDGE.test("import { A } from '../background/x.js';")).toBe(true);
        expect(STATIC_RUNTIME_EDGE.test("import type { A } from '../background/x.js';")).toBe(false);
        expect(STATIC_RUNTIME_EDGE.test("export { A } from '../background/x.js';")).toBe(true);
    });
});
