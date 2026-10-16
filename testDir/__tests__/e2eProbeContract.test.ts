/**
 * Contract pin: the E2E probe's session keys must be identical between the
 * content-side SSOT and the harness-side mirror (PBI 2026-10-11-11 NN11).
 *
 * `src/utils/e2eTestState.ts` owns `E2E_PROBE_ENABLE_KEY` /
 * `E2E_PROBE_STATE_KEY`; `testDir/e2e/fixtures/e2eProbe.ts` mirrors the
 * string literals (direct import was deferred: the mirror runs inside the
 * Playwright E2E runtime, which cannot be executed in this environment, so
 * the import path stays unverified — see the PBI). A one-sided rename or
 * typo otherwise silences the whole E2E suite (probe never arms / never
 * reads), so drift must fail loudly here.
 *
 * The fixture is read as text (not imported): it depends on
 * `@playwright/test`, which the unit runner must not pull in.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_PROBE_ENABLE_KEY, E2E_PROBE_STATE_KEY } from '../../src/utils/e2eTestState.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const srcRoot = join(repoRoot, 'src');
const fixtureText = readFileSync(join(here, '..', 'e2e', 'fixtures', 'e2eProbe.ts'), 'utf-8');

describe('e2eProbe key contract (NN11)', () => {
    it('mirrors the enable key string from the SSOT', () => {
        expect(E2E_PROBE_ENABLE_KEY).toBe('owE2eProbeEnabled');
        expect(fixtureText).toContain(`'${E2E_PROBE_ENABLE_KEY}'`);
    });

    it('mirrors the state key string from the SSOT', () => {
        expect(E2E_PROBE_STATE_KEY).toBe('owE2eTestState');
        expect(fixtureText).toContain(`'${E2E_PROBE_STATE_KEY}'`);
    });
});

/**
 * Double-owner pin (System Architect / Maintainability review 2026-10-15).
 *
 * Two production modules mutate the isolated-world window global
 * `window.__OW_TEST_STATE` — e2eTestState.publishE2eTestState and
 * e2eProbeRelay.relayProbeState — and both claim "Single owner" in their
 * comments. Consolidating them into one module is Phase-5 work; until then
 * this pin forbids a THIRD owner from appearing, so the drift surface cannot
 * grow while the consolidation is pending. The allowlist is a subset check on
 * purpose: after consolidation (relay stops writing the window) the pin keeps
 * passing.
 *
 * Consolidation done (Phase 5 fix, same review): the window leg now has one
 * writer — e2eProbeRelay — because publishE2eTestState lost its window branch
 * (it runs in the service worker, which has no window) and became the session
 * leg only, and the zero-caller markE2eVisitReported was deleted. The
 * allowlist is kept as the 2-module subset check: narrowing it to the single
 * surviving owner stays green, and a third writer still fails.
 */
describe('e2eProbe window-global ownership (double-owner pin)', () => {
    const WINDOW_OWNER_ALLOWLIST = new Set([
        'src/utils/e2eTestState.ts',
        'src/content/e2eProbeRelay.ts',
    ]);

    // Mutations only: direct assignment (`window.__OW_TEST_STATE = state`) and
    // in-place field writes (`window.__OW_TEST_STATE.flag = true`). Reads,
    // the `Window` interface declaration, and `delete` cleanups do not match.
    const OWNER_WRITE_PATTERN = /window\.__OW_TEST_STATE\s*(=|\.\w+\s*=)/;

    /** Recursively collect production .ts files, skipping test directories. */
    function collectSourceFiles(dir: string): string[] {
        const out: string[] = [];
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === '__tests__') continue;
                out.push(...collectSourceFiles(full));
            } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
                out.push(full);
            }
        }
        return out;
    }

    it('the owner detector recognizes mutations and ignores reads and declarations', () => {
        expect(OWNER_WRITE_PATTERN.test('        window.__OW_TEST_STATE = state;')).toBe(true);
        expect(OWNER_WRITE_PATTERN.test('        window.__OW_TEST_STATE.isValidVisitReported = true;')).toBe(true);
        expect(OWNER_WRITE_PATTERN.test('        __OW_TEST_STATE?: OWTestState;')).toBe(false);
        expect(OWNER_WRITE_PATTERN.test("        if (typeof window !== 'undefined' && window.__OW_TEST_STATE) {")).toBe(false);
        expect(OWNER_WRITE_PATTERN.test('        expect(window.__OW_TEST_STATE).toBe(STATE);')).toBe(false);
    });

    it('keeps window.__OW_TEST_STATE mutations inside the allowlisted modules only', () => {
        const owners: string[] = [];
        for (const file of collectSourceFiles(srcRoot)) {
            if (OWNER_WRITE_PATTERN.test(readFileSync(file, 'utf-8'))) {
                owners.push(relative(repoRoot, file).split('\\').join('/'));
            }
        }
        for (const owner of owners) {
            expect(WINDOW_OWNER_ALLOWLIST.has(owner), `unexpected window-global owner: ${owner}`).toBe(true);
        }
    });
});

/**
 * Dead-export pin (Legacy Bridge review 2026-10-15).
 *
 * `markE2eVisitReported` is the pre-relay report path: it writes the window
 * global and `chrome.storage.session` directly, but a content script cannot
 * reach session storage (which is why e2eProbeRelay exists). It has zero
 * callers, and a future caller that picks it would silently lose probe
 * reports. The invariant is "no references outside the defining module";
 * deleting the export entirely also keeps this pin green.
 */
describe('markE2eVisitReported dead export (legacy-path pin)', () => {
    it('has no callers anywhere in src/ or testDir/ outside its defining module', () => {
        const definingModule = join(srcRoot, 'utils', 'e2eTestState.ts');
        const selfFile = fileURLToPath(import.meta.url);
        const strayReferences: string[] = [];
        for (const root of [srcRoot, join(repoRoot, 'testDir')]) {
            const stack = [root];
            while (stack.length > 0) {
                const dir = stack.pop() as string;
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    const full = join(dir, entry.name);
                    if (entry.isDirectory()) {
                        stack.push(full);
                    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
                        if (full === definingModule || full === selfFile) continue;
                        if (readFileSync(full, 'utf-8').includes('markE2eVisitReported')) {
                            strayReferences.push(relative(repoRoot, full).split('\\').join('/'));
                        }
                    }
                }
            }
        }
        expect(strayReferences).toEqual([]);
    });
});
