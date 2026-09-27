/**
 * providerBreaker.test.ts — PBI 27-03 (policy: PBI 15 report §3-§5).
 * Unit tests for the breaker policy SSOT: matrix, thresholds, cooldowns,
 * half-open, malformed state, key hygiene, serialization, fail-open.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BREAKER_FAILURE_THRESHOLD,
  BREAKER_COOLDOWN_MS,
  BREAKER_AUTH_COOLDOWN_MS,
  BREAKER_RATE_LIMIT_COOLDOWN_MS,
  breakerKey,
  breakerInputFor,
  nextEntry,
  shouldAttemptEntry,
  ProviderBreaker,
  disabledBreaker,
} from '../providerBreaker.js';
import { FailureKind, type FailureMetadata } from '../../../utils/failureTaxonomy.js';
import type { SessionStorePort } from '../../sessionStore.js';

const failure = (kind: FailureMetadata['kind'], status?: number): FailureMetadata =>
  status === undefined ? { kind } : { kind, status };

function memoryStore(initial: Record<string, unknown> = {}): SessionStorePort & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: async <T,>(key: string): Promise<T | null> => (data.has(key) ? (data.get(key) as T) : null),
    set: async (key: string, value: unknown): Promise<void> => {
      data.set(key, value);
    },
    remove: (key: string): void => {
      data.delete(key);
    },
  };
}

describe('breakerKey', () => {
  it('namespaces by provider and model without secrets', () => {
    expect(breakerKey('openai', 'gpt-4o')).toBe('openai::gpt-4o');
    expect(breakerKey('openai')).toBe('openai::default');
  });

  it('never embeds an API key', () => {
    const key = breakerKey('openai', 'gpt-4o');
    expect(key).not.toContain('sk-');
    expect(key).not.toMatch(/[A-Za-z0-9]{32,}/);
  });
});

describe('parameter table (policy §4)', () => {
  it('pins the agreed numbers', () => {
    expect(BREAKER_FAILURE_THRESHOLD).toBe(3);
    expect(BREAKER_COOLDOWN_MS).toBe(5 * 60 * 1000);
    expect(BREAKER_AUTH_COOLDOWN_MS).toBe(15 * 60 * 1000);
    expect(BREAKER_RATE_LIMIT_COOLDOWN_MS).toBe(10 * 60 * 1000);
  });
});

describe('breakerInputFor (policy §3 matrix)', () => {
  it.each([
    ['network', undefined],
    ['timeout', undefined],
    ['http', 500],
    ['http', 503],
    ['http', 400],
    ['auth', 401],
    ['auth', 403],
    ['rate_limit', 429],
  ] as Array<[FailureMetadata['kind'], number | undefined]>)('counts %s', (kind, status) => {
    expect(breakerInputFor(failure(kind, status))).toBe('count');
  });

  it.each([['configuration'], ['csp']] as Array<[FailureMetadata['kind']]>)('ignores %s', (kind) => {
    expect(breakerInputFor(failure(kind))).toBe('ignore');
  });
});

describe('nextEntry', () => {
  const NOW = 1_700_000_000_000;

  it('resets on any success', () => {
    const current = { failures: 2, openedAt: NOW - 1000, openUntil: NOW + 1000, openedBy: 'network' as const };
    expect(nextEntry(current, { type: 'success' }, NOW)).toBeUndefined();
  });

  it('leaves the entry untouched for ignored kinds', () => {
    const current = { failures: 2 };
    expect(nextEntry(current, { type: 'failure', failure: failure('configuration') }, NOW)).toBe(current);
    expect(nextEntry(undefined, { type: 'failure', failure: failure('csp') }, NOW)).toBeUndefined();
  });

  it('counts below the threshold without opening', () => {
    expect(nextEntry(undefined, { type: 'failure', failure: failure('network') }, NOW)).toEqual({ failures: 1 });
    expect(nextEntry({ failures: 1 }, { type: 'failure', failure: failure('timeout') }, NOW)).toEqual({ failures: 2 });
  });

  it('opens the cooldown exactly at the threshold', () => {
    const next = nextEntry({ failures: 2 }, { type: 'failure', failure: failure('http', 503) }, NOW);
    expect(next).toMatchObject({
      failures: 3,
      openedAt: NOW,
      openUntil: NOW + BREAKER_COOLDOWN_MS,
      openedBy: 'http',
    });
  });

  it('opens immediately on the first auth failure with the long cooldown', () => {
    const next = nextEntry(undefined, { type: 'failure', failure: failure('auth', 401) }, NOW);
    expect(next).toMatchObject({
      failures: 1,
      openedAt: NOW,
      openUntil: NOW + BREAKER_AUTH_COOLDOWN_MS,
      openedBy: 'auth',
    });
  });

  it('opens immediately on the first rate-limit with its cooldown', () => {
    const next = nextEntry(undefined, { type: 'failure', failure: failure('rate_limit', 429) }, NOW);
    expect(next).toMatchObject({
      failures: 1,
      openedAt: NOW,
      openUntil: NOW + BREAKER_RATE_LIMIT_COOLDOWN_MS,
      openedBy: 'rate_limit',
    });
  });

  it('reopens from now on a failure after expiry', () => {
    const expired = { failures: 3, openedAt: NOW - 10 * 60 * 1000, openUntil: NOW - 1000, openedBy: 'network' as const };
    const next = nextEntry(expired, { type: 'failure', failure: failure('network') }, NOW);
    expect(next).toMatchObject({ failures: 4, openedAt: NOW, openUntil: NOW + BREAKER_COOLDOWN_MS });
  });
});

describe('shouldAttemptEntry (lazy half-open)', () => {
  const NOW = 1_700_000_000_000;

  it('attempts with no entry and with a below-threshold entry', () => {
    expect(shouldAttemptEntry(undefined, NOW)).toBe(true);
    expect(shouldAttemptEntry({ failures: 2 }, NOW)).toBe(true);
  });

  it('skips while the cooldown is open', () => {
    expect(shouldAttemptEntry({ failures: 3, openedAt: NOW, openUntil: NOW + 1000 }, NOW)).toBe(false);
    expect(shouldAttemptEntry({ failures: 3, openedAt: NOW, openUntil: NOW + 1000 }, NOW + 999)).toBe(false);
  });

  it('probes exactly at and after expiry', () => {
    const entry = { failures: 3, openedAt: NOW, openUntil: NOW + 1000 };
    expect(shouldAttemptEntry(entry, NOW + 1000)).toBe(true);
    expect(shouldAttemptEntry(entry, NOW + 60_000)).toBe(true);
  });
});

describe('ProviderBreaker store behavior', () => {
  const KEY = 'sw:aiProviderBreaker';
  let store: ReturnType<typeof memoryStore>;

  beforeEach(() => {
    store = memoryStore();
  });

  it('persists entries under the session key with flushImmediately', async () => {
    const setSpy = vi.spyOn(store, 'set');
    const breaker = new ProviderBreaker(store);
    await breaker.recordFailure('openai', 'gpt-4o', failure('network'));
    expect(setSpy).toHaveBeenCalledWith(
      KEY,
      expect.objectContaining({ 'openai::gpt-4o': expect.objectContaining({ failures: 1 }) }),
      { flushImmediately: true },
    );
  });

  it('treats a missing state as all-attemptable', async () => {
    const breaker = new ProviderBreaker(store);
    await expect(breaker.shouldAttempt('openai', 'gpt-4o')).resolves.toBe(true);
  });

  it('drops malformed entries fail-open', async () => {
    store.data.set(KEY, {
      'openai::gpt-4o': { failures: 'many', openUntil: 'soon' },
      'anthropic::claude': { failures: 3, openedAt: 1, openUntil: Date.now() + 60_000 },
    });
    const breaker = new ProviderBreaker(store);
    // Malformed entry reads as attemptable; the well-formed one still cools down.
    await expect(breaker.shouldAttempt('openai', 'gpt-4o')).resolves.toBe(true);
    await expect(breaker.shouldAttempt('anthropic', 'claude')).resolves.toBe(false);
  });

  it('serializes concurrent updates without loss', async () => {
    const breaker = new ProviderBreaker(store);
    await Promise.all([
      breaker.recordFailure('openai', 'gpt-4o', failure('network')),
      breaker.recordFailure('openai', 'gpt-4o', failure('timeout')),
      breaker.recordFailure('openai', 'gpt-4o', failure('http', 500)),
    ]);
    const state = store.data.get(KEY) as Record<string, { failures: number; openUntil?: number }>;
    expect(state['openai::gpt-4o']?.failures).toBe(3);
    expect(state['openai::gpt-4o']?.openUntil).toBeGreaterThan(Date.now());
    await expect(breaker.shouldAttempt('openai', 'gpt-4o')).resolves.toBe(false);
  });

  it('serializes concurrent updates across DIFFERENT keys without loss', async () => {
    // The whole state is one store key, so a per-slot chain would let these
    // interleave between the read and the write and drop each other's entry —
    // which is how a failing provider silently never reaches its threshold.
    const breaker = new ProviderBreaker(store);
    await Promise.all([
      breaker.recordFailure('openai', 'gpt-4o', failure('network')),
      breaker.recordFailure('anthropic', 'claude', failure('timeout')),
      breaker.recordFailure('gemini', 'flash', failure('network')),
    ]);
    const state = store.data.get(KEY) as Record<string, { failures: number }>;
    expect(state['openai::gpt-4o']?.failures).toBe(1);
    expect(state['anthropic::claude']?.failures).toBe(1);
    expect(state['gemini::flash']?.failures).toBe(1);
  });

  it('reports the cooldown that suppressed a slot', async () => {
    const breaker = new ProviderBreaker(store);
    await breaker.recordFailure('openai', 'gpt-4o', failure('auth', 401));
    await expect(breaker.shouldAttempt('openai', 'gpt-4o')).resolves.toBe(false);

    const cooldown = await breaker.cooldown('openai', 'gpt-4o');
    expect(cooldown?.kind).toBe(FailureKind.AUTH);
    expect(cooldown?.openUntil).toBeGreaterThan(Date.now());
    // A healthy slot has no cooldown, and neither does the disabled breaker.
    await expect(breaker.cooldown('openai', 'other-model')).resolves.toBeNull();
    await expect(disabledBreaker.cooldown('openai', 'gpt-4o')).resolves.toBeNull();
  });

  it('fails open when the store throws', async () => {
    const broken: SessionStorePort = {
      get: async () => {
        throw new Error('session gone');
      },
      set: async () => {
        throw new Error('session gone');
      },
      remove: () => {},
    };
    const breaker = new ProviderBreaker(broken);
    await expect(breaker.shouldAttempt('openai')).resolves.toBe(true);
    // Recording must not throw either — the summary fallback keeps running.
    await expect(breaker.recordFailure('openai', undefined, failure('network'))).resolves.toBeUndefined();
    await expect(breaker.recordSuccess('openai')).resolves.toBeUndefined();
  });

  it('success deletes the entry', async () => {
    const breaker = new ProviderBreaker(store);
    await breaker.recordFailure('openai', 'gpt-4o', failure('network'));
    await breaker.recordSuccess('openai', 'gpt-4o');
    const state = store.data.get(KEY) as Record<string, unknown>;
    expect(state['openai::gpt-4o']).toBeUndefined();
  });
});

describe('disabledBreaker', () => {
  it('attempts everything and records nothing', async () => {
    await expect(disabledBreaker.shouldAttempt('x', 'y')).resolves.toBe(true);
    await expect(disabledBreaker.recordFailure('x', 'y', failure('network'))).resolves.toBeUndefined();
    await expect(disabledBreaker.recordSuccess('x')).resolves.toBeUndefined();
  });
});
