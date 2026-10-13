/**
 * Contract pin: the E2E probe's session keys must be identical between the
 * content-side SSOT and the harness-side mirror (PBI 2026-10-11-11 NN11).
 *
 * `src/content/e2eTestState.ts` owns `E2E_PROBE_ENABLE_KEY` /
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
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_PROBE_ENABLE_KEY, E2E_PROBE_STATE_KEY } from '../../src/content/e2eTestState.js';

const here = dirname(fileURLToPath(import.meta.url));
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
