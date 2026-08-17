/**
 * confirmTokenManager.ts
 * Extracted from service-worker.ts (PBI-05).
 * Manages the dashboardSqliteConfirmToken: generates a random UUID,
 * persists to chrome.storage.session, and reuses across SW restarts.
 */

const CONFIRM_TOKEN_KEY = 'dashboardSqliteConfirmToken';
let CONFIRM_TOKEN: string | null = null;

export async function ensureConfirmToken(): Promise<string> {
  if (CONFIRM_TOKEN) return CONFIRM_TOKEN;

  try {
    const stored = await chrome.storage.session.get(CONFIRM_TOKEN_KEY) as Record<string, string | undefined>;
    if (stored[CONFIRM_TOKEN_KEY]) {
      CONFIRM_TOKEN = stored[CONFIRM_TOKEN_KEY] as string;
      return CONFIRM_TOKEN;
    }
  } catch {
    // Best-effort persistence; in-memory token still protects this SW lifetime.
  }

  const token = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  try {
    await chrome.storage.session.set({ [CONFIRM_TOKEN_KEY]: token });
  } catch {
    // Best-effort persistence; in-memory token still protects this SW lifetime.
  }

  CONFIRM_TOKEN = token;
  return token;
}
