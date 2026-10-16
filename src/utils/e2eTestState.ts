/**
 * e2eTestState.ts
 * Neutral-layer SSOT for the E2E test-probe: session keys, the OWTestState
 * shape, the arming read, and the service-worker leg of the state publish.
 *
 * Lives in src/utils/ (neutral layer), NOT src/content/: its only runtime
 * consumer is the service worker (src/background/handlers/e2eProbeHandlers.ts)
 * and background → content imports are banned by lint (eslint.config.js).
 * src/content/ references it type-only, so the content bundle keeps no runtime
 * edge to this module.
 *
 * The two output routes have one owner each, split by the context that can
 * actually reach them:
 * - session leg (this module): the `owE2eTestState` chrome.storage.session
 *   key, written only from the service worker (content scripts cannot reach
 *   session storage);
 * - window leg (src/content/e2eProbeRelay.ts): the isolated-world
 *   window.__OW_TEST_STATE global, written only from the content script.
 * PBI 2026-10-11-08 (NN08): the probe no longer touches the page-shared DOM.
 * Both former page-visible routes are closed:
 * - enablement moved from the page-writable `data-ow-e2e-test` attribute to
 *   the `owE2eProbeEnabled` chrome.storage.session flag (page JS has no
 *   chrome API, so it can neither set nor read it);
 * - output moved from the page-readable `data-ow-test-state` attribute to
 *   the extension-side routes above (both invisible to page JS).
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

/**
 * Shape of the isolated-world window global (invisible to page JS). The
 * shape lives here as the SSOT; the value is written only by
 * src/content/e2eProbeRelay.ts.
 */
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
 * Publish the E2E test state to the session leg: the `owE2eTestState`
 * chrome.storage.session key the harness reads back through the service
 * worker. Never writes page-shared DOM, and deliberately does not touch
 * window.__OW_TEST_STATE — this function runs in the service worker (which
 * has no `window`), so the window write that used to sit here was dead code
 * as well as a second owner claim. The window leg belongs to
 * src/content/e2eProbeRelay.ts (single owner, pinned by
 * testDir/__tests__/e2eProbeContract.test.ts).
 * Fire-and-forget session write — probe output must not break the pipeline.
 */
export function publishE2eTestState(state: OWTestState): void {
    if (!E2E_PROBE_COMPILED_IN) return;
    const session = sessionArea();
    if (!session) return;
    try {
        void Promise.resolve(session.set({ [E2E_PROBE_STATE_KEY]: state })).catch(() => {});
    } catch {
        // Non-fatal — a failed session write must never break the pipeline.
    }
}
