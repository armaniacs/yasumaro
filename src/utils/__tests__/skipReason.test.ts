/**
 * skipReason.test.ts
 *
 * Last-skip-reason vocabulary + chrome.storage.session round trip
 * (PBI 2026-10-31-01). The persisted record carries the reason type and the
 * consecutive count only — no URL, no title, no content — so the popup can
 * answer "why was this not recorded" without storing anything an attacker or
 * a synced profile could read back as page text.
 *
 * The store leg is chrome.storage.session only: the module never touches
 * chrome.storage.local, so the settings migration (settingsMigration.ts) and
 * the raw-owned-key audit pin never see the key.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  SKIP_REASON_CODES,
  SKIP_REASON_SESSION_KEY,
  isSkipReasonCode,
  nextSkipReason,
  normalizeSkipReason,
  recordSkipReason,
  readLastSkipReason,
} from '../skipReason.js';

function stubSession(store: Record<string, unknown>): {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
} {
  const get = vi.fn((key?: string | string[] | null) => {
    if (typeof key === 'string') {
      return Promise.resolve(key in store ? { [key]: store[key] } : {});
    }
    return Promise.resolve({ ...store });
  });
  const set = vi.fn((items: Record<string, unknown>) => {
    Object.assign(store, items);
    return Promise.resolve();
  });
  const local = { get: vi.fn(), set: vi.fn() };
  vi.stubGlobal('chrome', { storage: { session: { get, set }, local } });
  return { get, set };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('skip reason vocabulary', () => {
  it('declares the four reason codes the pipeline and the gate resolve to', () => {
    expect([...SKIP_REASON_CODES]).toEqual([
      'condition-not-met',
      'duplicate',
      'private-page',
      'pipeline-error',
    ]);
  });

  it('type-guards a code and rejects unknown values', () => {
    for (const code of SKIP_REASON_CODES) {
      expect(isSkipReasonCode(code)).toBe(true);
    }
    expect(isSkipReasonCode('something-else')).toBe(false);
    expect(isSkipReasonCode(42)).toBe(false);
    expect(isSkipReasonCode(undefined)).toBe(false);
  });
});

describe('nextSkipReason (pure)', () => {
  it('starts at count 1 from an absent record', () => {
    expect(nextSkipReason(null, 'condition-not-met')).toEqual({ reason: 'condition-not-met', count: 1 });
    expect(nextSkipReason(undefined, 'duplicate')).toEqual({ reason: 'duplicate', count: 1 });
  });

  it('increments the count when the same reason repeats (同日重複の回数)', () => {
    const first = nextSkipReason(null, 'duplicate');
    expect(nextSkipReason(first, 'duplicate')).toEqual({ reason: 'duplicate', count: 2 });
    expect(nextSkipReason({ reason: 'duplicate', count: 2 }, 'duplicate')).toEqual({
      reason: 'duplicate',
      count: 3,
    });
  });

  it('resets the count when a different reason arrives', () => {
    expect(nextSkipReason({ reason: 'condition-not-met', count: 4 }, 'duplicate')).toEqual({
      reason: 'duplicate',
      count: 1,
    });
  });
});

describe('normalizeSkipReason (fail-closed reader)', () => {
  it('reads a valid record', () => {
    expect(normalizeSkipReason({ reason: 'duplicate', count: 2 })).toEqual({
      reason: 'duplicate',
      count: 2,
    });
  });

  it('reads foreign shapes as null so the panel renders nothing instead of crashing', () => {
    expect(normalizeSkipReason(null)).toBeNull();
    expect(normalizeSkipReason(undefined)).toBeNull();
    expect(normalizeSkipReason('recorded')).toBeNull();
    expect(normalizeSkipReason({ reason: 'not-a-code', count: 1 })).toBeNull();
    expect(normalizeSkipReason({ reason: 'duplicate' })).toBeNull();
    expect(normalizeSkipReason({ reason: 'duplicate', count: 0 })).toBeNull();
    expect(normalizeSkipReason({ reason: 'duplicate', count: -1 })).toBeNull();
    expect(normalizeSkipReason({ reason: 'duplicate', count: 1.5 })).toBeNull();
  });
});

describe('session round trip (chrome.storage.session)', () => {
  it('records a skip and reads it back with reason type and count only', async () => {
    const store: Record<string, unknown> = {};
    const { get, set } = stubSession(store);

    await recordSkipReason('duplicate');

    expect(set).toHaveBeenCalledWith({ [SKIP_REASON_SESSION_KEY]: { reason: 'duplicate', count: 1 } });
    expect(store[SKIP_REASON_SESSION_KEY]).toEqual({ reason: 'duplicate', count: 1 });

    const read = await readLastSkipReason();
    expect(read).toEqual({ reason: 'duplicate', count: 1 });
    expect(get).toHaveBeenCalledWith(SKIP_REASON_SESSION_KEY);
  });

  it('accumulates the count across repeated skips of the same reason', async () => {
    const store: Record<string, unknown> = {};
    stubSession(store);

    await recordSkipReason('condition-not-met');
    await recordSkipReason('condition-not-met');

    expect(await readLastSkipReason()).toEqual({ reason: 'condition-not-met', count: 2 });
  });

  it('keeps the record across a service-worker restart (stateless SW re-reads session)', async () => {
    const store: Record<string, unknown> = {};
    stubSession(store);
    await recordSkipReason('condition-not-met');

    // A restarted service worker has no in-memory state: it re-reads the
    // session area through a fresh accessor. The record survives.
    stubSession(store);
    expect(await readLastSkipReason()).toEqual({ reason: 'condition-not-met', count: 1 });
  });

  it('never writes chrome.storage.local (the settings migration never sees the key)', async () => {
    const store: Record<string, unknown> = {};
    const { set } = stubSession(store);
    const chromeRef = globalThis as unknown as {
      chrome?: { storage?: { local?: { set: ReturnType<typeof vi.fn> } } };
    };
    const localArea = chromeRef.chrome?.storage?.local;

    await recordSkipReason('duplicate');

    expect(set).toHaveBeenCalledTimes(1);
    expect(localArea?.set).not.toHaveBeenCalled();
  });

  it('is fail-safe: a storage failure never throws and leaves no partial record', async () => {
    stubSession({});
    const chromeRef = globalThis as { chrome?: { storage?: { session?: { get: unknown; set: unknown } } } };
    if (chromeRef.chrome?.storage?.session) {
      chromeRef.chrome.storage.session.set = vi.fn(() => Promise.reject(new Error('quota exceeded')));
    }

    await expect(recordSkipReason('duplicate')).resolves.toBeNull();
    await expect(readLastSkipReason()).resolves.toBeNull();
  });

  it('resolves null outside the extension context (no chrome.storage.session)', async () => {
    vi.stubGlobal('chrome', {});
    await expect(recordSkipReason('duplicate')).resolves.toBeNull();
    await expect(readLastSkipReason()).resolves.toBeNull();
  });
});
