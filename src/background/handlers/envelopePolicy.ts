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

import {
  VALID_MESSAGE_TYPES,
  NO_PAYLOAD_TYPES,
  CURRENT_PROTOCOL_VERSION,
  PROTOCOL_VERSION_WINDOW_SIZE,
  type ExtensionMessage,
} from '../messageTypes.js';

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
  if (!rawMessage || typeof rawMessage !== 'object') {
    return { accepted: false, response: INVALID_MESSAGE_ERROR };
  }
  const msg = rawMessage as Record<string, unknown>;
  if (typeof msg.type !== 'string' || !VALID_MESSAGE_TYPES.includes(msg.type as typeof VALID_MESSAGE_TYPES[number])) {
    return { accepted: false, response: INVALID_MESSAGE_ERROR };
  }
  if (!NO_PAYLOAD_TYPES.includes(msg.type as typeof NO_PAYLOAD_TYPES[number])) {
    if (msg.payload === undefined || typeof msg.payload !== 'object') {
      return { accepted: false, response: INVALID_MESSAGE_ERROR };
    }
  }

  const versionVerdict = classifyProtocolVersion(msg.protocolVersion);
  if (versionVerdict === 'unsupported') {
    return {
      accepted: false,
      response: { success: false, error: 'Protocol version mismatch' },
      versionMismatch: {
        expected: CURRENT_PROTOCOL_VERSION,
        actual: msg.protocolVersion,
        type: msg.type,
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
        type: msg.type,
      },
    };
  }

  return { accepted: true, message };
}
