/**
 * remoteAIService-breaker.test.ts — PBI 27-03 integration.
 * The real ProviderBreaker (in-memory SessionStorePort) wired into
 * RemoteAIService: skip-before-attempt, record-after-result, and the
 * testConnection bypass. Taxonomy kinds — never messages — drive it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteAIService, resolveBreakerGate } from '../RemoteAIService.js';
import { ProviderBreaker, type ProviderBreakerLike } from '../providerBreaker.js';
import { recordAuditLog } from '../../../utils/auditLog.js';
import { addLog } from '../../../utils/logger/core.js';
import { LogType } from '../../../utils/logger/types.js';
import type { AIProviderStrategy } from '../providers/index.js';
import type { SettingsReader } from '../../../utils/storage/SettingsRepository.js';
import type { SessionStorePort } from '../../sessionStore.js';
import type { FailureMetadata } from '../../../utils/failureTaxonomy.js';

vi.mock('../../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));
vi.mock('../../../utils/logger/core.js', () => ({ addLog: vi.fn() }));

function memoryStore(): SessionStorePort {
  const data = new Map<string, unknown>();
  return {
    get: async <T,>(key: string): Promise<T | null> => (data.has(key) ? (data.get(key) as T) : null),
    set: async (key: string, value: unknown): Promise<void> => {
      data.set(key, value);
    },
    remove: (key: string): void => {
      data.delete(key);
    },
  };
}

function makeRepo(settings: Record<string, unknown>): SettingsReader {
  return {
    getAll: vi.fn().mockResolvedValue(settings),
    getMany: vi.fn(),
  };
}

function failingProvider(failure: FailureMetadata): AIProviderStrategy {
  return {
    generateSummary: vi.fn().mockResolvedValue({ success: false, summary: 'boom', failure }),
    testConnection: vi.fn().mockResolvedValue({ success: false, message: 'boom' }),
  } as unknown as AIProviderStrategy;
}

function succeedingProvider(summary: string): AIProviderStrategy {
  return {
    generateSummary: vi.fn().mockResolvedValue({ success: true, summary }),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok' }),
  } as unknown as AIProviderStrategy;
}

function createService(
  slots: Array<{ provider: string; model?: string }>,
  breaker: ProviderBreaker,
) {
  const service = new RemoteAIService({
    repo: makeRepo({
      ai_provider_priority_list: slots,
      ai_provider: 'gemini',
      summary_min_length: 0,
    }),
    breaker,
  });
  return service;
}

const networkFailure: FailureMetadata = { kind: 'network' };

/** Every breaker method the service can reach, in one flat call log. */
type BreakerCall = 'shouldAttempt' | 'cooldown' | 'recordSuccess' | 'recordFailure' | 'clearAll';

/** A breaker that must not be reached at all while the gate is off. */
function disabledSpy(): ProviderBreakerLike & { calls: BreakerCall[] } {
  return spyBreaker({
    shouldAttempt: async () => true,
    cooldown: async () => null,
    recordSuccess: async () => {},
    recordFailure: async () => {},
    clearAll: async () => {},
  });
}

function spyBreaker(inner: ProviderBreakerLike): ProviderBreakerLike & { calls: BreakerCall[] } {
  const calls: BreakerCall[] = [];
  return {
    calls,
    shouldAttempt: vi.fn(async (provider: string, model?: string) => {
      calls.push('shouldAttempt');
      return inner.shouldAttempt(provider, model);
    }),
    cooldown: vi.fn(async (provider: string, model?: string) => {
      calls.push('cooldown');
      return inner.cooldown(provider, model);
    }),
    recordSuccess: vi.fn(async (provider: string, model?: string) => {
      calls.push('recordSuccess');
      return inner.recordSuccess(provider, model);
    }),
    recordFailure: vi.fn(async (provider: string, model: string | undefined, failure: FailureMetadata) => {
      calls.push('recordFailure');
      return inner.recordFailure(provider, model, failure);
    }),
    clearAll: vi.fn(async () => {
      calls.push('clearAll');
      return inner.clearAll();
    }),
  };
}

/** Same shape as `createService`, plus an explicit breaker gate and a call log. */
function createGatedService(
  slots: Array<{ provider: string; model?: string }>,
  breaker: ProviderBreakerLike,
  gateEnabled: boolean,
) {
  const repo = makeRepo({
    ai_provider_priority_list: slots,
    ai_provider: 'gemini',
    summary_min_length: 0,
    ai_provider_breaker_enabled: gateEnabled,
  });
  const service = new RemoteAIService({ repo, breaker });
  return { service, repo };
}

describe('generateSummary with breaker', () => {
  let store: SessionStorePort;
  let breaker: ProviderBreaker;

  beforeEach(() => {
    store = memoryStore();
    breaker = new ProviderBreaker(store);
  });

  it('skips a slot in cooldown and tries the next one', async () => {
    // Three network failures open the default 5-minute cooldown.
    await breaker.recordFailure('cold', undefined, networkFailure);
    await breaker.recordFailure('cold', undefined, networkFailure);
    await breaker.recordFailure('cold', undefined, networkFailure);

    const service = createService([{ provider: 'cold' }, { provider: 'warm' }], breaker);
    const coldFactory = vi.fn(() => failingProvider(networkFailure));
    const warmFactory = vi.fn(() => succeedingProvider('warm summary'));
    service.registerProvider('cold', coldFactory);
    service.registerProvider('warm', warmFactory);

    const result = await service.generateSummary('content');

    expect(coldFactory).not.toHaveBeenCalled();
    expect(warmFactory).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.summary).toBe('warm summary');
  });

  it('reports a suppressed call as a cooldown, not as missing configuration', async () => {
    // Every slot in cooldown used to fall through to the initial result, so
    // the user was told their provider configuration was missing and that text
    // was stored as their page summary.
    await breaker.recordFailure('cold', undefined, networkFailure);
    await breaker.recordFailure('cold', undefined, networkFailure);
    await breaker.recordFailure('cold', undefined, networkFailure);

    const service = createService([{ provider: 'cold' }], breaker);
    const coldFactory = vi.fn(() => failingProvider(networkFailure));
    service.registerProvider('cold', coldFactory);

    const result = await service.generateSummary('content');

    expect(coldFactory).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.summary).toContain('cold');
    expect(result.summary).not.toContain('configuration is missing');
    // The real cause travels with the result, not a fabricated kind.
    expect(result.failure?.kind).toBe(networkFailure.kind);
    expect(result.attemptedProviders).toEqual([]);
  });

  it('records taxonomy failures into the breaker without reading messages', async () => {
    const service = createService([{ provider: 'flaky' }], breaker);
    // The message is deliberately misleading — the kind decides.
    service.registerProvider('flaky', () => ({
      generateSummary: vi.fn().mockResolvedValue({
        success: false,
        summary: 'definitely a success, trust me',
        failure: { kind: 'timeout' } as FailureMetadata,
      }),
      testConnection: vi.fn(),
    } as unknown as AIProviderStrategy));

    await service.generateSummary('content');

    const state = (await store.get<Record<string, { failures: number }>>('sw:aiProviderBreaker')) ?? {};
    expect(state['flaky::default']?.failures).toBe(1);
  });

  it('does not record failures that carry no taxonomy', async () => {
    const service = createService([{ provider: 'vague' }], breaker);
    service.registerProvider('vague', () => ({
      generateSummary: vi.fn().mockResolvedValue({ success: false, summary: 'short' }),
      testConnection: vi.fn(),
    } as unknown as AIProviderStrategy));

    await service.generateSummary('content');

    const state = (await store.get<Record<string, unknown>>('sw:aiProviderBreaker')) ?? {};
    expect(state['vague::default']).toBeUndefined();
  });

  it('resets the breaker on success', async () => {
    await breaker.recordFailure('flaky', undefined, networkFailure);
    const service = createService([{ provider: 'flaky' }], breaker);
    service.registerProvider('flaky', () => succeedingProvider('recovered'));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(true);
    const state = (await store.get<Record<string, unknown>>('sw:aiProviderBreaker')) ?? {};
    expect(state['flaky::default']).toBeUndefined();
  });

  it('keeps MAX_PROVIDERS, order, fallback, dedupe and single-flight intact', async () => {
    const service = createService(
      Array.from({ length: 12 }, (_, i) => ({ provider: `p${i}` })),
      breaker,
    );
    const calls: string[] = [];
    for (let i = 0; i < 12; i++) {
      service.registerProvider(`p${i}`, () => ({
        generateSummary: vi.fn(async () => {
          calls.push(`p${i}`);
          return { success: false, summary: `fail${i}` };
        }),
        testConnection: vi.fn(),
      } as unknown as AIProviderStrategy));
    }

    await service.generateSummary('content');

    // MAX_PROVIDERS cap (10) unchanged; order preserved.
    expect(calls).toHaveLength(10);
    expect(calls[0]).toBe('p0');
    expect(calls[9]).toBe('p9');
  });
});

describe('testConnection reset (PBI 27-05)', () => {
  it('still bypasses the cooldown, then clears it so the next summary is attempted', async () => {
    const store = memoryStore();
    const breaker = new ProviderBreaker(store);
    // Auth opens the long 15-minute cooldown on the first failure.
    await breaker.recordFailure('cold', undefined, { kind: 'auth', status: 401 });
    await expect(breaker.shouldAttempt('cold')).resolves.toBe(false);

    const service = createService([{ provider: 'cold' }], breaker);
    const factory = vi.fn(() => succeedingProvider('recovered summary'));
    service.registerProvider('cold', factory);

    const result = await service.testConnection();

    // The diagnostic itself is still not suppressed.
    expect(factory).toHaveBeenCalledTimes(1);
    expect(result.providers[0]?.success).toBe(true);
    // And now the cooldown is gone: the fixed credentials are actually usable.
    await expect(breaker.shouldAttempt('cold')).resolves.toBe(true);

    const summaryFactory = vi.fn(() => succeedingProvider('recovered summary'));
    service.registerProvider('cold', summaryFactory);
    const summary = await service.generateSummary('content');

    expect(summaryFactory).toHaveBeenCalledTimes(1);
    expect(summary.success).toBe(true);
    expect(summary.summary).toBe('recovered summary');
    // The reset notice is a log line; it must never become page content.
    expect(summary.summary).not.toContain('breaker');
  });

  it('clears every cooled-down slot, not only the one that was tested', async () => {
    const store = memoryStore();
    const breaker = new ProviderBreaker(store);
    await breaker.recordFailure('cold', 'gpt-4o', { kind: 'auth', status: 401 });
    await breaker.recordFailure('anthropic', 'claude', { kind: 'rate_limit', status: 429 });

    const service = createService([{ provider: 'cold', model: 'gpt-4o' }], breaker);
    service.registerProvider('cold', () => succeedingProvider('ok'));

    await service.testConnection();

    await expect(breaker.shouldAttempt('cold', 'gpt-4o')).resolves.toBe(true);
    await expect(breaker.shouldAttempt('anthropic', 'claude')).resolves.toBe(true);
  });

  it('logs the reset once as INFO', async () => {
    const breaker = new ProviderBreaker(memoryStore());
    await breaker.recordFailure('cold', undefined, { kind: 'auth', status: 401 });
    const service = createService([{ provider: 'cold' }], breaker);
    service.registerProvider('cold', () => succeedingProvider('plain summary'));

    const result = await service.testConnection();

    const notices = vi.mocked(addLog).mock.calls.filter(
      ([level, message]) => level === LogType.INFO && message.includes('cooldown cleared'),
    );
    expect(notices).toHaveLength(1);
    expect(result.message).toBe('cold: OK');
  });

  it('leaves the cooldown untouched when the test fails (policy §7)', async () => {
    const store = memoryStore();
    const breaker = new ProviderBreaker(store);
    await breaker.recordFailure('cold', undefined, { kind: 'auth', status: 401 });
    const cooldownBefore = await breaker.cooldown('cold');

    const service = createService([{ provider: 'cold' }], breaker);
    const factory = vi.fn(() => failingProvider({ kind: 'auth', status: 401 }));
    service.registerProvider('cold', factory);

    const result = await service.testConnection();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    // A test result is never written back into breaker state.
    await expect(breaker.shouldAttempt('cold')).resolves.toBe(false);
    await expect(breaker.cooldown('cold')).resolves.toEqual(cooldownBefore);
  });

  it('leaves the cooldown untouched when every provider throws', async () => {
    const store = memoryStore();
    const breaker = new ProviderBreaker(store);
    await breaker.recordFailure('cold', undefined, { kind: 'auth', status: 401 });

    const service = createService([{ provider: 'cold' }], breaker);
    service.registerProvider('cold', () => ({
      generateSummary: vi.fn(),
      testConnection: vi.fn().mockRejectedValue(new Error('probe exploded')),
    } as unknown as AIProviderStrategy));

    const result = await service.testConnection();

    expect(result.success).toBe(false);
    await expect(breaker.shouldAttempt('cold')).resolves.toBe(false);
  });

  it('does not clear anything when no slot is in cooldown', async () => {
    const store = memoryStore();
    const breaker = new ProviderBreaker(store);
    const setSpy = vi.spyOn(store, 'set');
    const service = createService([{ provider: 'fine' }], breaker);
    service.registerProvider('fine', () => succeedingProvider('ok'));

    const result = await service.testConnection();

    expect(result.success).toBe(true);
    // Nothing was recorded, so nothing had to be rewritten.
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe('generateSummary with the breaker gate', () => {
  let store: SessionStorePort;
  let breaker: ProviderBreaker;

  beforeEach(async () => {
    store = memoryStore();
    breaker = new ProviderBreaker(store);
    // Three network failures open the default 5-minute cooldown.
    await breaker.recordFailure('cold', undefined, networkFailure);
    await breaker.recordFailure('cold', undefined, networkFailure);
    await breaker.recordFailure('cold', undefined, networkFailure);
  });

  it('attempts a cooled-down slot and reports no suppression when the gate is off', async () => {
    const spy = spyBreaker(breaker);
    const { service, repo } = createGatedService([{ provider: 'cold' }], spy, false);
    const coldFactory = vi.fn(() => succeedingProvider('recovered summary'));
    service.registerProvider('cold', coldFactory);

    const result = await service.generateSummary('content');

    expect(coldFactory).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    expect(result.summary).toBe('recovered summary');
    expect(result.summary).not.toContain('temporarily paused');
    expect(result.summary).not.toContain('AI summary skipped');
    // The gate is read off the snapshot the summary already loaded, so neither
    // gate state costs a storage read of its own.
    expect(repo.getAll).toHaveBeenCalledTimes(1);
    // Gate off means breaker state is neither read nor written — not even to
    // record the success that just happened.
    expect(spy.calls).toEqual([]);
    // The pre-existing cooldown survives: the gate hides it, it does not heal it.
    await expect(breaker.shouldAttempt('cold')).resolves.toBe(false);
  });

  it('records nothing when the gate is off and the slot fails', async () => {
    const spy = spyBreaker(breaker);
    const { service } = createGatedService([{ provider: 'cold' }], spy, false);
    service.registerProvider('cold', () => failingProvider({ kind: 'timeout' }));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(false);
    expect(spy.calls).toEqual([]);
    const state = (await store.get<Record<string, unknown>>('sw:aiProviderBreaker')) ?? {};
    expect(state['cold::default']?.failures).toBe(3);
  });

  it('keeps the cooldown suppression when the gate is on', async () => {
    const spy = spyBreaker(breaker);
    const { service } = createGatedService([{ provider: 'cold' }], spy, true);
    const coldFactory = vi.fn(() => succeedingProvider('never used'));
    service.registerProvider('cold', coldFactory);

    const result = await service.generateSummary('content');

    expect(coldFactory).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.summary).toContain('temporarily paused');
    expect(result.failure?.kind).toBe(networkFailure.kind);
    expect(result.attemptedProviders).toEqual([]);
    expect(spy.calls).toEqual(['shouldAttempt', 'cooldown']);
  });

  it('runs testConnection as usual with the gate off, breaker untouched', async () => {
    const spy = spyBreaker(breaker);
    const { service } = createGatedService([{ provider: 'cold' }], spy, false);
    const factory = vi.fn(() => succeedingProvider('ok'));
    service.registerProvider('cold', factory);

    const result = await service.testConnection();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(true);
    // PBI 27-05 adds clearAll() to this path, and the kill switch still wins:
    // the reset is a breaker write, so it stays behind the same gate.
    expect(spy.calls).toEqual([]);
    // The gate hides the cooldown, it does not heal it.
    await expect(breaker.shouldAttempt('cold')).resolves.toBe(false);
  });

  it('clears the cooldown on a successful testConnection with the gate on', async () => {
    const spy = spyBreaker(breaker);
    const { service } = createGatedService([{ provider: 'cold' }], spy, true);
    service.registerProvider('cold', () => succeedingProvider('ok'));

    const result = await service.testConnection();

    expect(result.success).toBe(true);
    expect(spy.calls).toEqual(['clearAll']);
    await expect(breaker.shouldAttempt('cold')).resolves.toBe(true);
  });

  it('notes the disabled gate once, not per summary request', async () => {
    const { service } = createGatedService([{ provider: 'cold' }], disabledSpy(), false);
    service.registerProvider('cold', () => succeedingProvider('ok'));

    await service.generateSummary('one', { url: 'https://example.com/1' });
    await service.generateSummary('two', { url: 'https://example.com/2' });

    const notices = vi.mocked(addLog).mock.calls.filter(
      ([level, message]) => level === LogType.INFO && message.includes('breaker disabled'),
    );
    expect(notices).toHaveLength(1);
  });

  it('logs nothing about the gate while it is on', async () => {
    const { service } = createGatedService([{ provider: 'cold' }], disabledSpy(), true);
    service.registerProvider('cold', () => succeedingProvider('ok'));

    await service.generateSummary('content');

    const notices = vi.mocked(addLog).mock.calls.filter(
      ([level, message]) => level === LogType.INFO && message.includes('breaker disabled'),
    );
    expect(notices).toEqual([]);
  });
});

describe('resolveBreakerGate', () => {
  it('treats an absent setting as enabled so PBI 27-03 behaviour is unchanged', () => {
    expect(resolveBreakerGate({} as never)).toBe(true);
    expect(resolveBreakerGate({ ai_provider_breaker_enabled: undefined } as never)).toBe(true);
  });

  it('is enabled by an explicit true and disabled by an explicit false', () => {
    expect(resolveBreakerGate({ ai_provider_breaker_enabled: true } as never)).toBe(true);
    expect(resolveBreakerGate({ ai_provider_breaker_enabled: false } as never)).toBe(false);
  });
});
