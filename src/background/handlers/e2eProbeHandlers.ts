/**
 * e2eProbeHandlers.ts
 * Service-worker side of the E2E probe relay (PBI 2026-10-11-08 follow-up).
 *
 * Content scripts cannot reach chrome.storage.session (empirically confirmed:
 * armed flag set via SW, new code running, yet zero publishes), so the
 * session leg is owned here: the query handler answers arming from the
 * session flag, the state handler persists reports into session storage
 * where the E2E harness reads them. Both reuse the single session publisher in
 * src/utils/e2eTestState.ts (neutral layer — a background → content import is
 * banned by lint; the module imports nothing, so it adds no further runtime
 * edge in either bundle).
 *
 * Both legs are gated on the same arming flag (Blue Team review 2026-10-15):
 * the query reports it, the state handler refuses to write without it, so the
 * one content-script-reachable path into session storage stays closed unless
 * the harness armed the probe. The window leg is owned by
 * src/content/e2eProbeRelay.ts; this module only owns the session leg.
 *
 * No externally_connectable in the manifest, so page JS cannot send these
 * types. Trust tier is content-script-allowed (registry derives it from
 * CONTENT_SCRIPT_ALLOWED_TYPES); no sender.tab requirement unlike
 * VALID_VISIT/CHECK_DOMAIN, which need a live page for recording semantics.
 */

import { isE2EProbeEnabled, publishE2eTestState } from '../../utils/e2eTestState.js';
import type {
  OwE2eProbeQueryMessage,
  OwE2EProbeStateMessage,
} from '../messageTypes.js';

export function createE2EProbeQueryHandler() {
  return async (
    _message: OwE2eProbeQueryMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    sendResponse({ success: true, enabled: await isE2EProbeEnabled() });
  };
}

export function createE2EProbeStateHandler() {
  return async (
    message: OwE2EProbeStateMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    // Arming gate, symmetric with the query handler above: this handler is the
    // only content-script-reachable write into chrome.storage.session, so a
    // disarmed probe must be refused instead of overwriting the harness state.
    if (!(await isE2EProbeEnabled())) {
      sendResponse({ success: false, error: 'E2E probe is not armed' });
      return;
    }
    publishE2eTestState(message.payload);
    sendResponse({ success: true });
  };
}
