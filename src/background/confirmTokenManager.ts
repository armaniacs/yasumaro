/**
 * confirmTokenManager.ts
 * Extracted from service-worker.ts (PBI-05).
 * Manages the dashboardSqliteConfirmToken: generates a random UUID,
 * persists to chrome.storage.session, and reuses across SW restarts.
 *
 * 5 Whys (PBI-25):
 * 1. Why divergence? ensureConfirmToken did try { set } catch {} then CONFIRM_TOKEN=token unconditionally
 * 2. Why best-effort? Assumed in-memory alone protects current SW lifetime
 * 3. Why restart fails? SW restart loads old/empty token from storage, mismatches dashboard cached token
 * 4. Why not detected? No test mocked storage.set failure to assert memory/storage atomicity
 * 5. Why fix now? Enforce storage as single source of truth: assign CONFIRM_TOKEN only after set succeeds + retry with exponential backoff
 */

const CONFIRM_TOKEN_KEY = 'dashboardSqliteConfirmToken';
let CONFIRM_TOKEN: string | null = null;

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ensureConfirmToken(): Promise<string> {
  if (CONFIRM_TOKEN) return CONFIRM_TOKEN;

  // 1) Load with retry (exponential backoff). Final get failure falls through to generation
  //    without polluting CONFIRM_TOKEN, preserving storage as source of truth.
  let stored: Record<string, string | undefined> | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      stored = (await chrome.storage.session.get(CONFIRM_TOKEN_KEY)) as Record<
        string,
        string | undefined
      >;
      break;
    } catch {
      if (attempt === MAX_RETRIES - 1) break;
      await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }
  if (stored?.[CONFIRM_TOKEN_KEY]) {
    CONFIRM_TOKEN = stored[CONFIRM_TOKEN_KEY] as string;
    return CONFIRM_TOKEN;
  }

  const token =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Array.from(crypto.getRandomValues(new Uint8Array(16)))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');

  // 2) Persist with retry; assign CONFIRM_TOKEN only on success to keep memory/storage atomic.
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      await chrome.storage.session.set({ [CONFIRM_TOKEN_KEY]: token });
      CONFIRM_TOKEN = token;
      return token;
    } catch (e) {
      lastError = e;
      if (attempt < MAX_RETRIES - 1) await sleep(BASE_DELAY_MS * 2 ** attempt);
    }
  }

  // All retries failed: do not assign diverging token, propagate error so caller can retry.
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Test helper: simulate SW restart by clearing in-memory cache. */
export function __resetConfirmTokenForTesting(): void {
  CONFIRM_TOKEN = null;
}
