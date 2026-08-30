/**
 * confirmTokenManager.ts
 * Per-action single-use short-TTL (60s) confirm token.
 * Stored only in chrome.storage.session, validated on verify with TTL and single-use consumption.
 */

export const CONFIRM_TOKENS_SESSION_KEY = 'dashboardSqliteConfirmTokens';
export const CONFIRM_TOKEN_TTL_MS = 60_000;

export interface ConfirmTokenRecord {
  token: string;
  action: string;
  id?: number;
  expiresAt: number;
}

type TokenMap = Record<string, ConfirmTokenRecord>;

function generateToken(): string {
  if (typeof crypto !== 'undefined' && typeof (crypto as unknown as { randomUUID?: () => string }).randomUUID === 'function') {
    return (crypto as unknown as { randomUUID: () => string }).randomUUID!();
  }
  const bytes = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint8Array(16))
    : new Uint8Array(16).map(() => Math.floor(Math.random() * 256));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function loadMap(): Promise<TokenMap> {
  try {
    const stored = await chrome.storage.session.get(CONFIRM_TOKENS_SESSION_KEY) as Record<string, TokenMap | undefined>;
    return (stored[CONFIRM_TOKENS_SESSION_KEY] as TokenMap) ?? {};
  } catch {
    return {};
  }
}

async function saveMap(map: TokenMap): Promise<void> {
  await chrome.storage.session.set({ [CONFIRM_TOKENS_SESSION_KEY]: map });
}

function isExpired(rec: ConfirmTokenRecord): boolean {
  return Date.now() > rec.expiresAt;
}

function pruneExpired(map: TokenMap): boolean {
  let pruned = false;
  for (const [k, v] of Object.entries(map)) {
    if (isExpired(v)) {
      delete map[k];
      pruned = true;
    }
  }
  return pruned;
}

/**
 * Create a single-use token bound to action (+ optional id) with 60s TTL.
 * Stored only in chrome.storage.session.
 */
export async function createConfirmToken(action: string, id?: number): Promise<string> {
  const token = generateToken();
  const expiresAt = Date.now() + CONFIRM_TOKEN_TTL_MS;
  const record: ConfirmTokenRecord = { token, action, expiresAt, ...(id !== undefined ? { id } : {}) };
  const map = await loadMap();
  pruneExpired(map);
  map[token] = record;
  await saveMap(map);
  return token;
}

/**
 * Verify token for given action/id, enforce TTL and single-use (consumes on success).
 * Returns true only if token exists, not expired, action/id match, and not already consumed.
 */
export async function verifyConfirmToken(token: string, action: string, id?: number): Promise<boolean> {
  if (!token || typeof token !== 'string') return false;
  const map = await loadMap();
  const rec = map[token];
  if (!rec) return false;
  if (isExpired(rec)) {
    delete map[token];
    try { await saveMap(map); } catch {}
    return false;
  }
  if (rec.action !== action) return false;
  const recId = rec.id;
  const wantId = id;
  if (recId !== wantId) {
    // Strict compare: both undefined -> equal, otherwise must match
    if (!(recId === undefined && wantId === undefined) && recId !== wantId) return false;
  }
  // Single-use: consume
  delete map[token];
  try { await saveMap(map); } catch {}
  return true;
}

/**
 * Legacy single-token helper kept for backward wiring tests that mock getConfirmToken.
 * Delegates to create/verify map via a generic action. Not used in production path.
 */
export async function ensureConfirmToken(): Promise<string> {
  return createConfirmToken('__legacy__');
}

export async function ensureConfirmTokenLegacy(): Promise<string> {
  return createConfirmToken('__legacy__');
}

/** Test helpers */
export async function __resetConfirmTokensForTesting(): Promise<void> {
  try { await chrome.storage.session.remove(CONFIRM_TOKENS_SESSION_KEY); } catch {}
}
export function __resetConfirmTokenForTesting(): void {
  // Synchronous wrapper for legacy tests that expect sync reset; fire-and-forget
  void __resetConfirmTokensForTesting();
}
