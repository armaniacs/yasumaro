/**
 * e2eProbeHandlers.ts
 * Service-worker side of the E2E probe relay (PBI 2026-10-11-08 follow-up).
 *
 * Content scripts cannot reach chrome.storage.session (empirically confirmed:
 * armed flag set via SW, new code running, yet zero publishes), so the
 * session leg is owned here: the query handler answers arming from the
 * session flag, the state handler persists reports into session storage
 * where the E2E harness reads them. Both reuse the single publisher in
 * src/content/e2eTestState.ts (leaf module, no imports — importing it here
 * adds no runtime edge in either bundle).
 *
 * No externally_connectable in the manifest, so page JS cannot send these
 * types. Trust tier is content-script-allowed (registry derives it from
 * CONTENT_SCRIPT_ALLOWED_TYPES); no sender.tab requirement unlike
 * VALID_VISIT/CHECK_DOMAIN, which need a live page for recording semantics.
 */

import { isE2EProbeEnabled, publishE2eTestState } from '../../content/e2eTestState.js';
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
    publishE2eTestState(message.payload);
    sendResponse({ success: true });
  };
}
