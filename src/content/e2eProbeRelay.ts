/**
 * e2eProbeRelay.ts
 * Content-script side of the E2E probe relay (PBI 2026-10-11-08 follow-up).
 *
 * Content scripts cannot reach chrome.storage.session (empirically confirmed:
 * armed flag set via SW, new code running, yet zero publishes), so arming
 * queries and state reports travel as runtime messages; the service worker
 * owns the session leg (src/background/handlers/e2eProbeHandlers.ts).
 * The harness↔SW leg is unchanged (session keys), so testDir fixtures and
 * E2E specs need no changes.
 *
 * Build-time kill switch: own `__OW_E2E_PROBE__` guard (same pattern as
 * __OW_BENCH__ in loader.ts; SSOT define lives in wxt.config.ts). A shared
 * import of the flag was deliberately avoided to keep it module-private
 * (PBI 2026-10-11-15). When stripped, every function below is a no-op and
 * the message-type literals are dead-code eliminated with the bodies.
 */

import type { MessageSender } from './visitReporter.js';
import type { OWTestState } from './e2eTestState.js';

declare const __OW_E2E_PROBE__: boolean | undefined;
const RELAY_COMPILED_IN: boolean =
    typeof __OW_E2E_PROBE__ === 'undefined' || __OW_E2E_PROBE__ !== false;

/**
 * Ask the service worker whether the probe is armed (it reads the session
 * flag on our behalf). Fail-safe: any transport failure, missing success
 * flag, or non-true enabled resolves to disarmed — the probe must never
 * break the visit pipeline.
 */
export async function queryProbeArmed(sender: MessageSender): Promise<boolean> {
    if (!RELAY_COMPILED_IN) return false;
    try {
        const response = await sender.sendMessageWithRetry({ type: 'OW_PROBE_QUERY' });
        if (!response || response.success !== true) return false;
        return (response as { enabled?: unknown }).enabled === true;
    } catch {
        return false;
    }
}

/**
 * Report probe state through the service worker (fire-and-forget) and mirror
 * it to the isolated-world window global (invisible to page JS, pinned by
 * unit goldens). Never writes page-shared DOM. Never throws.
 */
export function relayProbeState(sender: MessageSender, state: OWTestState): void {
    if (!RELAY_COMPILED_IN) return;
    try {
        if (typeof window !== 'undefined') {
            window.__OW_TEST_STATE = state;
        }
    } catch {
        // Window write is best-effort only.
    }
    try {
        void Promise.resolve(
            sender.sendMessageWithRetry({ type: 'OW_PROBE_STATE', payload: state }),
        ).catch(() => {});
    } catch {
        // Probe output must not break the pipeline.
    }
}

/**
 * Mark the latest published state as reported and relay it. Single owner of
 * the window-global mutation so callers never touch __OW_TEST_STATE directly.
 */
export function markProbeVisitReported(sender: MessageSender): void {
    if (!RELAY_COMPILED_IN) return;
    try {
        if (typeof window !== 'undefined' && window.__OW_TEST_STATE) {
            window.__OW_TEST_STATE.isValidVisitReported = true;
            relayProbeState(sender, window.__OW_TEST_STATE);
        }
    } catch {
        // Probe output must not break the pipeline.
    }
}
