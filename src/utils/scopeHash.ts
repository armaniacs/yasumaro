// @layer 0 — Foundation: chrome-independent SHA-256 scope hash for confirm tokens
/**
 * scopeHash.ts
 * SHA-256 hex digest over destructive parameters, position-sensitive
 * (undefined/null become empty segments so arity is part of the scope).
 *
 * Pure, chrome-independent helper: `crypto.subtle` is available in service
 * workers, offscreen documents and extension pages alike. Fail-closed: throws
 * when `crypto.subtle` is unavailable rather than degrading to a weaker hash.
 */
export async function computeScopeHash(
  parts: (string | number | undefined | null)[],
): Promise<string> {
  const joined = parts
    .map((p) => (p === undefined || p === null ? '' : String(p)))
    .join('|');
  if (typeof crypto === 'undefined' || typeof crypto.subtle?.digest !== 'function') {
    throw new Error('crypto.subtle unavailable; cannot compute confirm token scope hash');
  }
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(joined));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
