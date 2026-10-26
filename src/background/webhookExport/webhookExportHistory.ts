/**
 * webhookExportHistory.ts
 *
 * Transfer history + resend bookkeeping (PBI 2026-10-22-05, box (b)).
 *
 * Storage decision (なぜなぜ Topic 3: 利用者/保守者/攻撃者 × 5 whys):
 * chrome.storage.local under WEBHOOK_EXPORT_HISTORY_KEY — readable from both
 * SW and dashboard, readable in fallback environments (unlike the SQLite
 * offscreen gateway the audit ledger rides), and never leaves the device.
 * Bounded at WEBHOOK_EXPORT_HISTORY_CAP rows of minimal shape (no summary
 * text beyond a char count, origin instead of the full destination URL so a
 * token-bearing webhook URL never rests in the log).
 *
 * Idempotency (なぜなぜ Topic 2): every entry carries the deterministic key
 * `yasumaro-{recordId}-{fnv1a(canonical payload)}`. A resend reuses the key
 * (the server dedupes on Idempotency-Key); the send path suppresses an
 * automatic duplicate without touching the network and only an explicit
 * resend (force) re-POSTs — always to the saved settings destination, which
 * the resend API cannot override.
 */

export type WebhookExportHistoryStatus = 'sent' | 'blocked' | 'failed' | 'resent';

/** Minimal history row: 時刻・送信先(origin)・文字数・判定, never the body. */
export interface WebhookExportHistoryEntry {
  key: string;
  recordId: string;
  origin: string;
  status: WebhookExportHistoryStatus;
  reason: string;
  charCount: number;
  createdAt: number;
  resentCount: number;
}

/** Single chrome.storage.local key owning this feature's history. */
export const WEBHOOK_EXPORT_HISTORY_KEY = 'webhook_export_history_v1';

/**
 * Row cap: ~50 rows × a few hundred bytes stays far below the
 * chrome.storage.local quota, mirroring the denied_domains 100-row rationale.
 */
export const WEBHOOK_EXPORT_HISTORY_CAP = 50;

/** Minimal storage seam (default: chrome.storage.local, one string value). */
export interface WebhookExportHistoryStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

export function chromeLocalWebhookExportHistoryStore(): WebhookExportHistoryStore {
  return {
    get: async (key: string): Promise<string | null> => {
      const raw = await chrome.storage.local.get(key);
      const value: string | null = typeof raw[key] === 'string' ? (raw[key] as string) : null;
      return value;
    },
    set: async (key: string, value: string): Promise<void> => {
      await chrome.storage.local.set({ [key]: value });
    },
  };
}

/** FNV-1a (32-bit) over the canonical payload JSON — deterministic key part. */
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Deterministic idempotency key: same record + same payload = same key. */
export function deriveWebhookIdempotencyKey(recordId: string, canonicalPayload: string): string {
  return `yasumaro-${recordId}-${fnv1aHex(canonicalPayload)}`;
}

interface RawHistoryRow {
  key?: string;
  recordId?: string;
  origin?: string;
  status?: string;
  reason?: string;
  charCount?: number;
  createdAt?: number;
  resentCount?: number;
}

function isHistoryStatus(value: string): value is WebhookExportHistoryStatus {
  return value === 'sent' || value === 'blocked' || value === 'failed' || value === 'resent';
}

function normalizeRow(raw: RawHistoryRow | null | undefined): WebhookExportHistoryEntry | null {
  if (typeof raw !== 'object' || raw === null) return null;
  if (typeof raw.key !== 'string' || raw.key === '') return null;
  if (typeof raw.recordId !== 'string' || raw.recordId === '') return null;
  if (typeof raw.origin !== 'string' || raw.origin === '') return null;
  if (typeof raw.status !== 'string' || !isHistoryStatus(raw.status)) return null;
  return {
    key: raw.key,
    recordId: raw.recordId,
    origin: raw.origin,
    status: raw.status,
    reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 200) : '',
    charCount:
      typeof raw.charCount === 'number' && Number.isFinite(raw.charCount) ? Math.max(0, Math.floor(raw.charCount)) : 0,
    createdAt:
      typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? Math.max(0, Math.floor(raw.createdAt)) : 0,
    resentCount:
      typeof raw.resentCount === 'number' && Number.isFinite(raw.resentCount)
        ? Math.max(0, Math.floor(raw.resentCount))
        : 0,
  };
}

/** Fail-closed: garbage in storage yields an empty history, never a throw. */
export function normalizeWebhookExportHistory(raw: string | null): WebhookExportHistoryEntry[] {
  if (raw === null) return [];
  try {
    const parsed: RawHistoryRow[] = JSON.parse(raw) as RawHistoryRow[];
    if (!Array.isArray(parsed)) return [];
    const out: WebhookExportHistoryEntry[] = [];
    for (const row of parsed.slice(0, WEBHOOK_EXPORT_HISTORY_CAP)) {
      const normalized: WebhookExportHistoryEntry | null = normalizeRow(row);
      if (normalized !== null) out.push(normalized);
    }
    return out;
  } catch {
    return [];
  }
}

export class WebhookExportHistory {
  private readonly store: WebhookExportHistoryStore;

  constructor(store: WebhookExportHistoryStore = chromeLocalWebhookExportHistoryStore()) {
    this.store = store;
  }

  async list(): Promise<WebhookExportHistoryEntry[]> {
    return normalizeWebhookExportHistory(await this.store.get(WEBHOOK_EXPORT_HISTORY_KEY));
  }

  /** Appends newest-first, evicting the oldest past the cap. */
  async append(entry: WebhookExportHistoryEntry): Promise<WebhookExportHistoryEntry[]> {
    const next: WebhookExportHistoryEntry[] = [entry, ...(await this.list())].slice(0, WEBHOOK_EXPORT_HISTORY_CAP);
    await this.store.set(WEBHOOK_EXPORT_HISTORY_KEY, JSON.stringify(next));
    return next;
  }

  findByKey(entries: WebhookExportHistoryEntry[], key: string): WebhookExportHistoryEntry | null {
    for (const entry of entries) {
      if (entry.key === key) return entry;
    }
    return null;
  }

  /** Bumps the resend counter for an explicit resend (no payload rewrite). */
  async markResent(key: string, now: number): Promise<WebhookExportHistoryEntry[]> {
    const entries: WebhookExportHistoryEntry[] = await this.list();
    const next: WebhookExportHistoryEntry[] = entries.map((entry: WebhookExportHistoryEntry) => {
      if (entry.key !== key) return entry;
      const bumped: WebhookExportHistoryEntry = {
        ...entry,
        status: 'resent',
        createdAt: now,
        resentCount: entry.resentCount + 1,
      };
      return bumped;
    });
    await this.store.set(WEBHOOK_EXPORT_HISTORY_KEY, JSON.stringify(next));
    return next;
  }
}
