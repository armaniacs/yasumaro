import { expect, type BrowserContext } from '@playwright/test';

/**
 * E2E probe helpers (PBI 2026-10-11-08 NN08).
 *
 * The content-script probe is armed and read extension-side only, through
 * chrome.storage.session (SSOT: src/content/e2eTestState.ts). Page JS has no
 * chrome API, so it can neither arm the probe nor read its output — the
 * former page-DOM channel (`data-ow-e2e-test` / `data-ow-test-state`) is
 * inert. The harness reaches session storage through the extension service
 * worker, which launchExtensionContext guarantees to be running.
 *
 * Call enableE2EProbe() BEFORE navigating the test page: the content script
 * resolves the flag once at init.
 */

/** Mirrors E2E_PROBE_ENABLE_KEY in src/content/e2eTestState.ts. */
export const E2E_PROBE_ENABLE_KEY = 'owE2eProbeEnabled';
/** Mirrors E2E_PROBE_STATE_KEY in src/content/e2eTestState.ts. */
export const E2E_PROBE_STATE_KEY = 'owE2eTestState';

/** Mirrors OWTestState in src/content/e2eTestState.ts (field order matters). */
export interface E2EProbeState {
  maxScrollPercentage: number;
  isValidVisitReported: boolean;
  startTime: number;
  minVisitDuration: number;
  minScrollDepth: number;
  duration: number;
}

function serviceWorker(context: BrowserContext) {
  const sw = context.serviceWorkers()[0];
  if (!sw) throw new Error('E2E probe needs a running extension service worker');
  return sw;
}

/** Arm the probe for every page loaded afterwards in this context. */
export async function enableE2EProbe(context: BrowserContext): Promise<void> {
  await serviceWorker(context).evaluate((key) => {
    return chrome.storage.session.set({ [key]: true });
  }, E2E_PROBE_ENABLE_KEY);
}

/** Read the latest probe state, or null when the probe never published. */
export async function readE2EProbeState(context: BrowserContext): Promise<E2EProbeState | null> {
  const stored = await serviceWorker(context).evaluate((key) => {
    return chrome.storage.session.get(key);
  }, E2E_PROBE_STATE_KEY);
  const state = (stored as Record<string, unknown>)[E2E_PROBE_STATE_KEY] as E2EProbeState | undefined;
  return state ?? null;
}

/** Wait until the probe published its initial state (content script init). */
export async function waitForE2EProbeInit(context: BrowserContext, timeout = 10000): Promise<E2EProbeState> {
  // Poll purely as a wait: its result cannot narrow the closure variable.
  await expect
    .poll(async () => readE2EProbeState(context), { timeout, intervals: [200] })
    .not.toBeNull();
  const state = await readE2EProbeState(context);
  if (state === null) throw new Error('E2E probe state vanished after successful poll');
  return state;
}
