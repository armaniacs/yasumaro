import { expect, type BrowserContext } from '@playwright/test';

/**
 * E2E probe helpers (PBI 2026-10-11-08 NN08).
 *
 * The content-script probe is armed and read extension-side only, through
 * chrome.storage.session (SSOT: src/utils/e2eTestState.ts). Page JS has no
 * chrome API, so it can neither arm the probe nor read its output — the
 * former page-DOM channel (`data-ow-e2e-test` / `data-ow-test-state`) is
 * inert. The harness reaches session storage through the extension service
 * worker, which launchExtensionContext guarantees to be running.
 *
 * Call enableE2EProbe() BEFORE navigating the test page: the content script
 * resolves the flag once at init.
 */

/** Mirrors E2E_PROBE_ENABLE_KEY in src/utils/e2eTestState.ts. */
export const E2E_PROBE_ENABLE_KEY = 'owE2eProbeEnabled';
/** Mirrors E2E_PROBE_STATE_KEY in src/utils/e2eTestState.ts. */
export const E2E_PROBE_STATE_KEY = 'owE2eTestState';

/** Mirrors OWTestState in src/utils/e2eTestState.ts (field order matters). */
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

/**
 * Wait until the probe published its initial state (content script init).
 *
 * Staged so a timeout names the leg that broke (PBI 2026-11-24-20):
 *   1. stage service-worker: a service worker is alive and responsive
 *   2. stage armed: the session arming flag is set
 *   3. stage content-state: the content script published its initial state
 *
 * The ceiling is generous on purpose: CI runners are shared 4-vCPU boxes
 * with cold caches, and locally measured init ranges from 1.8s (warm) to
 * 5.7s (cold) for the same page. This is a condition wait, not a fixed
 * sleep, so fast machines resolve early and never pay the ceiling. The
 * three stages share one deadline, so the total never exceeds `timeout`.
 */
export async function waitForE2EProbeInit(context: BrowserContext, timeout = 30000): Promise<E2EProbeState> {
  const deadline = Date.now() + timeout;
  const remaining = () => Math.max(1, deadline - Date.now());

  // Stage 1: service worker alive and responsive.
  try {
    await expect
      .poll(
        async () => {
          const worker = context.serviceWorkers()[0];
          if (!worker) return null;
          try {
            const alive = await worker.evaluate(() => true);
            return alive === true ? 'alive' : null;
          } catch {
            return null;
          }
        },
        { timeout: remaining(), intervals: [200] },
      )
      .toBe('alive');
  } catch {
    throw new Error(
      `E2E probe init timed out at stage service-worker: service worker not alive/responsive within ${timeout}ms`,
    );
  }

  // Stage 2: armed flag set in session storage (read through the SW).
  try {
    await expect
      .poll(
        async () => {
          try {
            const worker = context.serviceWorkers()[0];
            if (!worker) return null;
            const stored = await worker.evaluate((key) => {
              return chrome.storage.session.get(key);
            }, E2E_PROBE_ENABLE_KEY);
            return (stored as Record<string, unknown>)[E2E_PROBE_ENABLE_KEY] === true
              ? 'armed'
              : null;
          } catch {
            return null;
          }
        },
        { timeout: remaining(), intervals: [200] },
      )
      .toBe('armed');
  } catch {
    throw new Error(
      `E2E probe init timed out at stage armed: probe not armed (call enableE2EProbe before navigation) within ${timeout}ms`,
    );
  }

  // Stage 3: content script published its initial state.
  try {
    // Poll purely as a wait: its result cannot narrow the closure variable.
    await expect
      .poll(
        async () => {
          try {
            return await readE2EProbeState(context);
          } catch {
            return null;
          }
        },
        { timeout: remaining(), intervals: [200] },
      )
      .not.toBeNull();
  } catch {
    throw new Error(
      `E2E probe init timed out at stage content-state: content script initial state not published within ${timeout}ms`,
    );
  }
  const state = await readE2EProbeState(context);
  if (state === null) throw new Error('E2E probe state vanished after successful poll');
  return state;
}
