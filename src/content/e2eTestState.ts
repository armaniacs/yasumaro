/**
 * e2eTestState.ts
 * Single home + single publisher for the E2E test-probe state.
 *
 * PBI 2026-10-11-08 (NN08): the probe no longer touches the page-shared DOM.
 * Both former page-visible routes are closed:
 * - enablement moved from the page-writable `data-ow-e2e-test` attribute to
 *   the `owE2eProbeEnabled` chrome.storage.session flag (page JS has no
 *   chrome API, so it can neither set nor read it);
 * - output moved from the page-readable `data-ow-test-state` attribute to
 *   the `owE2eTestState` chrome.storage.session key, keeping only the
 *   isolated-world window.__OW_TEST_STATE global (invisible to page JS).
 * The E2E harness enables the probe and reads state through the extension
 * service worker (`context.serviceWorkers()[0].evaluate(...)`); see
 * testDir/e2e/fixtures/e2eProbe.ts.
 */

// Build-time kill switch (wxt.config.ts define, same pattern as __OW_BENCH__
// in loader.ts). Store release builds set OW_E2E_PROBE=0 so the probe is
// dead-code eliminated; dev/CI builds keep it (default true) so the E2E
// suite runs against a plain `npm run build`. Unit tests (vitest) leave the
// define undefined, which also keeps the probe enabled.
declare const __OW_E2E_PROBE__: boolean | undefined;
const E2E_PROBE_COMPILED_IN: boolean =
    typeof __OW_E2E_PROBE__ === 'undefined' || __OW_E2E_PROBE__ !== false;

/** Session flag the harness (via the SW) sets to arm the probe. */
export const E2E_PROBE_ENABLE_KEY = 'owE2eProbeEnabled';
/** Session key the probe publishes its latest state to. */
export const E2E_PROBE_STATE_KEY = 'owE2eTestState';

export interface OWTestState {
    maxScrollPercentage: number;
    isValidVisitReported: boolean;
    startTime: number;
    minVisitDuration: number;
    minScrollDepth: number;
    duration: number;
}

declare global {
    interface Window {
        __OW_TEST_STATE?: OWTestState;
    }
}

function sessionArea(): chrome.storage.StorageArea | undefined {
    try {
        if (typeof globalThis.chrome !== 'undefined' && globalThis.chrome.storage?.session) {
            return globalThis.chrome.storage.session;
        }
    } catch {
        // chrome access can throw in locked-down frames — treat as unavailable.
    }
    return undefined;
}

/**
 * Resolve whether the probe is armed. True only when the extension-side
 * session flag was set (harness via SW) and the probe survived the build.
 * Never consults page DOM — a page-set attribute must not enable anything.
 */
export async function isE2EProbeEnabled(): Promise<boolean> {
    if (!E2E_PROBE_COMPILED_IN) return false;
    const session = sessionArea();
    if (!session) return false;
    try {
        const got = (await session.get(E2E_PROBE_ENABLE_KEY)) as Record<string, unknown>;
        return got[E2E_PROBE_ENABLE_KEY] === true;
    } catch {
        return false;
    }
}

/**
 * Publish the E2E test state to extension-side routes only: the
 * isolated-world window global (invisible to page JS) and session storage
 * (unreadable from page JS). Never writes page-shared DOM.
 * Fire-and-forget session write — probe output must not break the pipeline.
 */
export function publishE2eTestState(state: OWTestState): void {
    if (!E2E_PROBE_COMPILED_IN) return;
    if (typeof window !== 'undefined') {
        window.__OW_TEST_STATE = state;
    }
    const session = sessionArea();
    if (!session) return;
    try {
        void Promise.resolve(session.set({ [E2E_PROBE_STATE_KEY]: state })).catch(() => {});
    } catch {
        // Non-fatal — the window global still carries the state for unit tests.
    }
}

/**
 * Mark the latest published state as reported and republish it. Single owner
 * of the window-global mutation so callers never touch __OW_TEST_STATE
 * directly (keeps the probe's window route inside this module, which also
 * lets OW_E2E_PROBE=0 builds eliminate every probe string).
 */
export function markE2eVisitReported(): void {
    if (!E2E_PROBE_COMPILED_IN) return;
    if (typeof window !== 'undefined' && window.__OW_TEST_STATE) {
        window.__OW_TEST_STATE.isValidVisitReported = true;
        publishE2eTestState(window.__OW_TEST_STATE);
    }
}
