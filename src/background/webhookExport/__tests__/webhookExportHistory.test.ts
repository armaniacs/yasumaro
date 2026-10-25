/**
 * webhookExportHistory.test.ts
 * PBI 2026-10-22-05 box (b) ― bounded history, deterministic idempotency keys.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveWebhookIdempotencyKey,
  fnv1aHex,
  normalizeWebhookExportHistory,
  WebhookExportHistory,
  WEBHOOK_EXPORT_HISTORY_CAP,
  type WebhookExportHistoryEntry,
  type WebhookExportHistoryStore,
} from '../webhookExportHistory.js';

function memoryStore(seed: Record<string, string> = {}): WebhookExportHistoryStore {
  const data: Record<string, string> = { ...seed };
  return {
    get: async (key: string): Promise<string | null> => (typeof data[key] === 'string' ? (data[key] as string) : null),
    set: async (key: string, value: string): Promise<void> => {
      data[key] = value;
    },
  };
}

function makeEntry(overrides: Partial<WebhookExportHistoryEntry> = {}): WebhookExportHistoryEntry {
  return {
    key: 'yasumaro-r1-abcdef01',
    recordId: 'r1',
    origin: 'https://hooks.example.com',
    status: 'sent',
    reason: 'delivered',
    charCount: 120,
    createdAt: 1000,
    resentCount: 0,
    ...overrides,
  };
}

describe('deriveWebhookIdempotencyKey', () => {
  it('is deterministic for the same record + payload', () => {
    expect(deriveWebhookIdempotencyKey('r1', '{"a":1}')).toBe(deriveWebhookIdempotencyKey('r1', '{"a":1}'));
  });

  it('separates different records and different payloads', () => {
    const base = deriveWebhookIdempotencyKey('r1', '{"a":1}');
    expect(deriveWebhookIdempotencyKey('r2', '{"a":1}')).not.toBe(base);
    expect(deriveWebhookIdempotencyKey('r1', '{"a":2}')).not.toBe(base);
  });

  it('uses FNV-1a hex (known vector: empty string)', () => {
    expect(fnv1aHex('')).toBe('811c9dc5');
  });
});

describe('normalizeWebhookExportHistory (fail-closed)', () => {
  it('returns [] on null / corrupt / non-array shapes', () => {
    expect(normalizeWebhookExportHistory(null)).toEqual([]);
    expect(normalizeWebhookExportHistory('{bad')).toEqual([]);
    expect(normalizeWebhookExportHistory('{"key":"x"}')).toEqual([]);
  });

  it('drops invalid rows but keeps valid ones', () => {
    const raw = JSON.stringify([makeEntry(), { key: '', status: 'sent' }, null, { key: 'k', recordId: 'r' }]);
    const rows = normalizeWebhookExportHistory(raw);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe('yasumaro-r1-abcdef01');
  });

  it('clamps numeric fields and truncates long reasons', () => {
    const raw = JSON.stringify([makeEntry({ charCount: -5, resentCount: Number.NaN, reason: 'x'.repeat(500) })]);
    const rows = normalizeWebhookExportHistory(raw);
    expect(rows[0]?.charCount).toBe(0);
    expect(rows[0]?.resentCount).toBe(0);
    expect(rows[0]?.reason).toHaveLength(200);
  });
});

describe('WebhookExportHistory store', () => {
  it('appends newest-first and evicts past the cap', async () => {
    const history = new WebhookExportHistory(memoryStore());
    for (let i = 0; i < WEBHOOK_EXPORT_HISTORY_CAP + 5; i++) {
      await history.append(makeEntry({ key: `k-${i}`, recordId: `r-${i}`, createdAt: i }));
    }
    const rows = await history.list();
    expect(rows).toHaveLength(WEBHOOK_EXPORT_HISTORY_CAP);
    expect(rows[0]?.key).toBe(`k-${WEBHOOK_EXPORT_HISTORY_CAP + 4}`);
    expect(rows.map((r) => r.key)).not.toContain('k-0');
  });

  it('markResent bumps status and counter without rewriting the payload key', async () => {
    const history = new WebhookExportHistory(memoryStore());
    await history.append(makeEntry());
    const next = await history.markResent('yasumaro-r1-abcdef01', 2000);
    expect(next[0]?.status).toBe('resent');
    expect(next[0]?.resentCount).toBe(1);
    expect(next[0]?.createdAt).toBe(2000);
    expect(next[0]?.key).toBe('yasumaro-r1-abcdef01');
  });

  it('findByKey returns null for unknown keys', async () => {
    const history = new WebhookExportHistory(memoryStore());
    await history.append(makeEntry());
    expect(history.findByKey(await history.list(), 'missing')).toBeNull();
  });
});
