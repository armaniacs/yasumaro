/**
 * envelopePolicy.ts — deep module owning message-envelope acceptance.
 *
 * Single seam: checkEnvelope() runs the ordered accept pipeline
 * (shape -> version -> restore-ordered migrations -> sender special-cases)
 * and returns accept/reject + reason. The router keeps trust + handler
 * lookup; its strict-sender block stays after trust on purpose (an untrusted
 * sender failing both checks must keep reporting the trust error, not
 * 'Invalid sender' — reordering would change the observable rejection).
 *
 * Policy sets live in one table with the reason attached, not as inline
 * literals scattered across the wrapper:
 * - MIGRATION_SKIP_TYPES: test/diagnostic paths that skip deferred
 *   migrations + tab-cache init.
 * - NULL_RESPONSE_NO_TAB_TYPES: answered with null when the sender has no
 *   tab (untrusted page ping), instead of reaching dispatch.
 */

import type { ExtensionMessage } from '../messageTypes.js';
import {
  CURRENT_PROTOCOL_VERSION,
  PROTOCOL_VERSION_WINDOW_SIZE,
} from '../../messaging/protocol.js';
import { isValidEnvelopeShape, isNoPayloadType } from '../../messaging/envelopeShape.js';
import { logInfo } from '../../utils/logger/api.js';

export const INVALID_MESSAGE_ERROR = { success: false, error: 'Invalid message' };

/**
 * Graded protocol-version migration window, expressed as a policy table so
 * the accept set stays derivable from one declaration instead of an ad-hoc
 * comparison. Only the version gate grades — size caps, trust levels, and
 * scheme checks downstream are untouched.
 *
 * - current: accepted cleanly.
 * - [minSupported, current): accepted with a deprecation detail (the caller
 *   warns and flags the response); covers one stale update cycle.
 * - missing (undefined): accepted as before (legacy senders carry no field).
 * - anything else: rejected with 'Protocol version mismatch' before any
 *   migration or tab-cache work runs.
 */
export interface ProtocolVersionWindow {
  current: number;
  minSupported: number;
  windowSize: number;
}

export const PROTOCOL_VERSION_POLICY: ProtocolVersionWindow = {
  current: CURRENT_PROTOCOL_VERSION,
  windowSize: PROTOCOL_VERSION_WINDOW_SIZE,
  minSupported: CURRENT_PROTOCOL_VERSION - PROTOCOL_VERSION_WINDOW_SIZE,
};

export type ProtocolVersionVerdict = 'absent' | 'current' | 'deprecated' | 'unsupported';

export function classifyProtocolVersion(
  value: unknown,
  policy: ProtocolVersionWindow = PROTOCOL_VERSION_POLICY,
): ProtocolVersionVerdict {
  if (value === undefined) return 'absent';
  if (value === policy.current) return 'current';
  if (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= policy.minSupported &&
    value < policy.current
  ) {
    return 'deprecated';
  }
  return 'unsupported';
}

export interface EnvelopePipelineDeps {
  runDeferredStartupMigrations: () => Promise<void>;
  initializeTabCache: () => Promise<void>;
}

export type EnvelopeOutcome =
  | { accepted: true; message: ExtensionMessage; deprecated?: VersionDetail | undefined }
  | {
      accepted: false;
      response: unknown;
      versionMismatch?: VersionDetail | undefined;
    };

interface VersionDetail {
  expected: number;
  actual: unknown;
  type: string;
}

/** Session-scoped count of accepted messages without a protocol version. Resets on SW restart. */
let absentVersionCounter = 0;

/**
 * Test seam: lets tests assert the absent-version counter. Production
 * diagnostics go through the logInfo trace in checkEnvelope instead
 * (PBI 2026-09-19-18), so nothing outside tests should read this.
 */
export function getAbsentVersionCount(): number {
  return absentVersionCounter;
}
/** Test seam — resets the absent-version counter. */
export function __resetAbsentVersionCountForTesting(): void {
  absentVersionCounter = 0;
}

/** Types that skip deferred migrations + tab-cache init (test/diagnostic paths). */
const MIGRATION_SKIP_TYPES: ReadonlySet<string> = new Set([
  'TEST_CONNECTIONS',
  'TEST_OBSIDIAN',
  'TEST_AI',
  'CHECK_DOMAIN',
]);

/** Types answered with null when the sender has no tab (untrusted page ping). */
const NULL_RESPONSE_NO_TAB_TYPES: ReadonlySet<string> = new Set(['CONTENT_CLEANSING_EXECUTED']);

/**
 * Run the envelope accept pipeline. Restore ordering (the two restores first)
 * stays in the wrapper — it is preamble, not policy.
 */
export async function checkEnvelope(
  rawMessage: unknown,
  sender: chrome.runtime.MessageSender,
  deps: EnvelopePipelineDeps,
): Promise<EnvelopeOutcome> {
  // Shape gate is single-sourced in messaging/envelopeShape.js: the strict
  // rule accepts TEST_OBSIDIAN / DASHBOARD_SQLITE without a payload
  // (optional-object裁定). The NO_PAYLOAD legacy exception below stays:
  // TEST_AI and ACTIVITY_UPDATE send `payload: {}` and must keep flowing
  // until the senders are fixed.
  if (!isValidEnvelopeShape(rawMessage)) {
    const type = (rawMessage as { type?: unknown } | null | undefined)?.type;
    if (!(typeof type === 'string' && isNoPayloadType(type))) {
      return { accepted: false, response: INVALID_MESSAGE_ERROR };
    }
  }
  const msg = rawMessage as Record<string, unknown>;
  // The shape gate above accepted the envelope, so type is a known string.
  // Narrow once for the diagnostic echoes below (EnvelopeOutcome.type: string).
  const msgType = typeof msg.type === 'string' ? msg.type : 'unknown';

  const versionVerdict = classifyProtocolVersion(msg.protocolVersion);
  if (versionVerdict === 'unsupported') {
    return {
      accepted: false,
      response: { success: false, error: 'Protocol version mismatch' },
      versionMismatch: {
        expected: CURRENT_PROTOCOL_VERSION,
        actual: msg.protocolVersion,
        type: msgType,
      },
    };
  }

  const message = rawMessage as ExtensionMessage;

  if (!MIGRATION_SKIP_TYPES.has(message.type)) {
    await deps.runDeferredStartupMigrations();
    await deps.initializeTabCache();
  }

  if (NULL_RESPONSE_NO_TAB_TYPES.has(message.type) && !sender.tab?.id) {
    return { accepted: false, response: null };
  }

  if (versionVerdict === 'deprecated') {
    return {
      accepted: true,
      message,
      deprecated: {
        expected: CURRENT_PROTOCOL_VERSION,
        actual: msg.protocolVersion,
        type: msgType,
      },
    };
  }

  if (versionVerdict === 'absent') {
    absentVersionCounter += 1;
    // Migration-progress diagnostics: log every 10th absent message so the
    // surviving-legacy-sender count is visible in the diagnostic logs without
    // a dedicated query path. Resets on SW restart (session-scoped).
    if (absentVersionCounter % 10 === 1) {
      void logInfo(`Protocol version absent (legacy sender): count=${absentVersionCounter}`, {
        type: msg.type,
      });
    }
    return {
      accepted: true,
      message,
      deprecated: {
        expected: CURRENT_PROTOCOL_VERSION,
        actual: msg.protocolVersion,
        type: msgType,
      },
    };
  }

  return { accepted: true, message };
}
