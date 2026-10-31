/**
 * skipReason.ts
 *
 * Last-skip-reason vocabulary + session store (PBI 2026-10-31-01).
 * The popup must answer "why was this page not recorded" without storing
 * anything an attacker or a synced profile could read back as page text, so
 * the persisted record carries the reason type and the consecutive count
 * only — no URL, no title, no content. 軸3「収集を増やさない」整合.
 *
 * The reason domain is the tree's own skip vocabulary: `condition-not-met`
 * (the pre-pipeline visit gate closed — stay/scroll below the threshold,
 * article pair or adaptive per-kind pair alike), `duplicate` (the
 * decideStepOutcome DuplicateError branch), `private-page` (the
 * PrivatePageError branch), and `pipeline-error` (the terminal
 * Regenerate/FATAL/RETRY branches). Unknown codes stay out instead of being
 * invented: the reader fails closed to null so the popup renders "no skip
 * yet" instead of a half-record.
 *
 * The store leg is chrome.storage.session only (MV3 service workers are
 * stateless; session storage survives a SW restart within the browser
 * session). The module never touches chrome.storage.local, so the settings
 * migration (settingsMigration.ts) and the raw-owned-key audit pin never see
 * the key — the key is module-owned here, like the `privacyCache_` session
 * keys, and deliberately not a `StorageKeys` member (session-only state, no
 * blob-tier reader).
 */

/** The skip reason codes. Declared here and nowhere else. */
export const SKIP_REASON_CODES = [
  'condition-not-met',
  'duplicate',
  'private-page',
  'pipeline-error',
] as const;

export type SkipReasonCode = (typeof SKIP_REASON_CODES)[number];

/** Persisted last-skip record: reason type + consecutive count only. */
export interface LastSkipReason {
  reason: SkipReasonCode;
  count: number;
}

/**
 * chrome.storage.session key. Module-owned (like the `privacyCache_` session
 * keys) and session-only: the value is never written to chrome.storage.local,
 * so the settings migration folds nothing and the raw-owned-key audit pin is
 * unaffected.
 */
export const SKIP_REASON_SESSION_KEY = 'last_skip_reason';

/** Type guard for a persisted/imported reason value. */
export function isSkipReasonCode(value: unknown): value is SkipReasonCode {
  return typeof value === 'string' && (SKIP_REASON_CODES as readonly string[]).includes(value);
}

/**
 * Pure next-record derivation. The count is the number of consecutive
 * occurrences of the reason: the same reason repeating increments it (the
 * 同日重複 case — a second skipped attempt reads "×2"), a different reason
 * resets it to 1. A success never records, so the count never claims a skip
 * the worker accepted.
 */
export function nextSkipReason(
  current: LastSkipReason | null | undefined,
  reason: SkipReasonCode,
): LastSkipReason {
  if (current && current.reason === reason) return { reason, count: current.count + 1 };
  return { reason, count: 1 };
}

/**
 * Fail-closed reader for the persisted record. Corrupt, partial, or foreign
 * shapes (older builds, garbage) read as null so the panel renders nothing
 * instead of crashing or showing a half-record.
 */
export function normalizeSkipReason(value: unknown): LastSkipReason | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { reason?: unknown; count?: unknown };
  if (!isSkipReasonCode(raw.reason)) return null;
  if (typeof raw.count !== 'number' || !Number.isInteger(raw.count) || raw.count < 1) return null;
  return { reason: raw.reason, count: raw.count };
}

/** chrome.storage.session accessor — undefined outside the extension. */
interface ChromeSessionArea {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

function sessionArea(): ChromeSessionArea | undefined {
  const holder = globalThis as { chrome?: { storage?: { session?: ChromeSessionArea } } };
  const area = holder.chrome?.storage?.session;
  if (!area || typeof area.get !== 'function' || typeof area.set !== 'function') return undefined;
  return area;
}

/**
 * Record the latest skip reason. Best-effort and fail-safe: never throws and
 * never rejects, so a diagnostics write must not break the outcome policy or
 * the relay handler (quota, missing chrome in tests, session reset races).
 * Returns the persisted record, or null when nothing was written.
 */
export async function recordSkipReason(reason: SkipReasonCode): Promise<LastSkipReason | null> {
  try {
    const area = sessionArea();
    if (!area) return null;
    const raw = await area.get(SKIP_REASON_SESSION_KEY);
    const next = nextSkipReason(normalizeSkipReason(raw?.[SKIP_REASON_SESSION_KEY]), reason);
    await area.set({ [SKIP_REASON_SESSION_KEY]: next });
    return next;
  } catch {
    // Diagnostics are advisory — a failed write must not fail the outcome.
    return null;
  }
}

/**
 * Best-effort read of the last skip reason for the popup. Returns null when
 * nothing was recorded yet or the stored shape is foreign.
 */
export async function readLastSkipReason(): Promise<LastSkipReason | null> {
  try {
    const area = sessionArea();
    if (!area) return null;
    const raw = await area.get(SKIP_REASON_SESSION_KEY);
    return normalizeSkipReason(raw?.[SKIP_REASON_SESSION_KEY]);
  } catch {
    return null;
  }
}
