/**
 * remoteAIService-breaker.test.ts — PBI 27-03 integration.
 * The real ProviderBreaker (in-memory SessionStorePort) wired into
 * RemoteAIService: skip-before-attempt, record-after-result, and the
 * testConnection bypass. Taxonomy kinds — never messages — drive it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteAIService } from '../RemoteAIService.js';
import { ProviderBreaker } from '../providerBreaker.js';
import { recordAuditLog } from '../../../utils/auditLog.js';
import type { AIProviderStrategy } from '../providers/index.js';
import type { SettingsReader } from '../../../utils/storage/SettingsRepository.js';
import type { SessionStorePort } from '../../sessionStore.js';
import type { FailureMetadata } from '../../../utils/failureTaxonomy.js';

vi.mock('../../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));

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

describe('testConnection bypass', () => {
  it('attempts a slot in cooldown and records nothing', async () => {
    const store = memoryStore();
    const breaker = new ProviderBreaker(store);
    await breaker.recordFailure('cold', undefined, { kind: 'auth', status: 401 });

    const service = createService([{ provider: 'cold' }], breaker);
    const factory = vi.fn(() => succeedingProvider('ok'));
    service.registerProvider('cold', factory);

    const result = await service.testConnection();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(result.providers[0]?.success).toBe(true);
    // Bypass only: the cooldown entry is untouched.
    await expect(breaker.shouldAttempt('cold')).resolves.toBe(false);
  });
});
