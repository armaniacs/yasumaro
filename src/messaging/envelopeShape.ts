// @layer 0 — Foundation: pure envelope-shape checks, no chrome dependencies
/**
 * envelopeShape.ts — single source of truth for SW-bound envelope shape.
 *
 * Three branches, one declaration (PBI 2026-10-05-13):
 * - NO_PAYLOAD_TYPES: `payload === undefined` required.
 * - OPTIONAL_PAYLOAD_TYPES (TEST_OBSIDIAN / DASHBOARD_SQLITE): `undefined`
 *   or a non-null object. The stored-settings fallback (TEST_OBSIDIAN) and
 *   the `payload || {}` guard (dashboardSqliteWiring) rely on missing being
 *   tolerated, while production senders always ship an object — so
 *   optional-object, not absent and not required, is the ruled shape.
 * - every other known type: a non-null object is required
 *   (`typeof` check only, matching the historic gate — deeper field checks
 *   stay in the per-type validators).
 *
 * Production exception (pinned, not fixed here): checkEnvelope still skips
 * the payload inspection for NO_PAYLOAD envelopes because TEST_AI and
 * ACTIVITY_UPDATE send `payload: {}`. Tightening that corner needs the
 * sender fixes, which are out of scope — the exception lives in
 * envelopePolicy, never in this module.
 */

import { VALID_MESSAGE_TYPES, NO_PAYLOAD_TYPES } from './messageTypeRegistry.js';

/**
 * Types whose envelope may omit the payload or carry an object.
 * Production senders always ship an object; handlers tolerate a missing
 * payload, so neither "add to NO_PAYLOAD_TYPES" nor "make it required"
 * matches reality.
 */
export const OPTIONAL_PAYLOAD_TYPES = ['TEST_OBSIDIAN', 'DASHBOARD_SQLITE'] as const;

export type OptionalPayloadType = (typeof OPTIONAL_PAYLOAD_TYPES)[number];

export function isKnownMessageType(type: unknown): type is (typeof VALID_MESSAGE_TYPES)[number] {
  return (
    typeof type === 'string' &&
    (VALID_MESSAGE_TYPES as readonly string[]).includes(type)
  );
}

export function isNoPayloadType(type: string): boolean {
  return (NO_PAYLOAD_TYPES as readonly string[]).includes(type);
}

export function isOptionalPayloadType(type: string): boolean {
  return (OPTIONAL_PAYLOAD_TYPES as readonly string[]).includes(type);
}

function hasUsablePayload(type: string, payload: unknown): boolean {
  if (isNoPayloadType(type)) {
    return payload === undefined;
  }
  if (isOptionalPayloadType(type)) {
    return payload === undefined || (typeof payload === 'object' && payload !== null);
  }
  return payload !== undefined && typeof payload === 'object';
}

/**
 * Single shape gate: known type + the payload rule of its branch.
 * `isServiceWorkerRequest` (messaging/types.ts) is a thin wrapper over this.
 */
export function isValidEnvelopeShape(message: unknown): boolean {
  if (!message || typeof message !== 'object') {
    return false;
  }
  const msg = message as { type?: unknown; payload?: unknown };
  if (!isKnownMessageType(msg.type)) {
    return false;
  }
  return hasUsablePayload(msg.type, msg.payload);
}
