/**
 * recordingSkipReasonHandlers.ts
 * Service-worker side of the recording skip reason relay (PBI 2026-10-31-01).
 *
 * Content scripts cannot reach chrome.storage.session (empirically confirmed
 * in e2eProbeRelay.ts), so the condition-not-met skip decided by the
 * pre-pipeline visit gate travels as a runtime message and this handler owns
 * the session leg: it persists the reason into chrome.storage.session where
 * the popup reads it back. The pipeline-side reasons (duplicate /
 * private-page / pipeline-error) are recorded in the outcome policy
 * (recordingOutcome.decideStepOutcome), not here.
 *
 * The session leg goes through the single publisher in src/utils/skipReason.ts
 * (neutral layer), so the popup reader and this writer share one key and one
 * normalization. Fail-safe: a diagnostics write failure acks a refusal
 * instead of throwing — the relay must not break the visit pipeline.
 *
 * Trust tier is content-script-allowed (registry derives it from
 * CONTENT_SCRIPT_ALLOWED_TYPES); no sender.tab requirement. The payload is a
 * reason code only — the handler stores a normalized record with the reason
 * type and the consecutive count, never a URL, a title, or content
 * (軸3「収集を増やさない」).
 */

import { recordSkipReason } from '../../utils/skipReason.js';
import type { RecordingSkipReasonMessage } from '../messageTypes.js';

export function createRecordingSkipReasonHandler() {
  return async (
    message: RecordingSkipReasonMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): Promise<void> => {
    try {
      const recorded = await recordSkipReason(message.payload.reason);
      sendResponse(recorded ? { success: true } : { success: false, error: 'skip reason recording failed' });
    } catch {
      sendResponse({ success: false, error: 'skip reason recording failed' });
    }
  };
}
