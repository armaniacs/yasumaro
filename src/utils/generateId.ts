/**
 * generateId.ts
 * Single source of truth for opaque unique-ID generation (PBI
 * 2026-10-03-24): crypto.randomUUID when available, else 128 bits from
 * crypto.getRandomValues rendered as 32 hex chars.
 *
 * Layer 0: pure function, no `chrome` / DOM / storage dependency.
 *
 * WHY one module: the randomUUID-or-fallback preamble was duplicated at four
 * call sites and the fallback formats had drifted apart — 32-char hex
 * (offlineNetworkQueue, confirmTokenManager) vs base36 2×Uint32
 * (RecordingOrchestrator, logger core). No call site parses or
 * format-validates the value (job ids and log entry ids are opaque storage
 * keys, traceIds are correlation labels, tokens are map keys), so the formats
 * were unified on hex: it is the stronger fallback (128 random bits vs ~61
 * for base36), it was already the security-critical site's format — keeping
 * the confirm-token path byte-identical in every branch — and it never
 * silently degrades (the base36 form collapsed to "00" when crypto was
 * absent entirely).
 *
 * NOT here on purpose: availability-gated issuance. confirmTokenManager must
 * fail CLOSED when no secure RNG exists — it pairs hasSecureRandom() with
 * generateId() so the missing-RNG branch throws instead of degrading. Call
 * sites that must never crash on a degraded environment wrap generateId()
 * in their own error handling (logger's addLog does).
 */

/**
 * True when a cryptographically secure random source exists in this context.
 * randomUUID and getRandomValues are checked separately: either alone is
 * enough for generateId() to produce a secure value.
 */
export function hasSecureRandom(): boolean {
  return (
    typeof crypto !== 'undefined' &&
    (typeof crypto.randomUUID === 'function' || typeof crypto.getRandomValues === 'function')
  );
}

export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
