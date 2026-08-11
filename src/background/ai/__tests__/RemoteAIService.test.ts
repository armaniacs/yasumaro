import { describe, it, expect, vi } from 'vitest';
import { RemoteAIService } from '../RemoteAIService.js';
import { AIProviderStrategy } from '../providers/index.js';

function makeProvider(summary: string, success = true): AIProviderStrategy {
  return {
    generateSummary: vi.fn().mockResolvedValue({ success, summary }),
    testConnection: vi.fn().mockResolvedValue({ success, message: summary }),
  };
}

function createService(providerSlots: Array<{ provider: string }>, getSettingsOverride?: () => Promise<Record<string, unknown>>) {
  const getSettings = getSettingsOverride || (async () => ({
    ai_provider_priority_list: providerSlots,
    ai_provider: 'gemini',
    summary_min_length: 0,
  } as Record<string, unknown>));
  return new RemoteAIService({ getSettings });
}

describe('RemoteAIService', () => {
  it('delegates generateSummary to the first successful provider', async () => {
    const service = createService([{ provider: 'test-provider' }]);
    service['registerProvider']('test-provider', () => makeProvider('test summary'));

    const result = await service.generateSummary('content', { url: 'https://example.com' });

    expect(result.summary).toBe('test summary');
    expect(result.success).toBe(true);
  });

  it('falls back to the next provider when the first fails', async () => {
    const service = createService([{ provider: 'fail-provider' }, { provider: 'success-provider' }]);
    service['registerProvider']('fail-provider', () => makeProvider('fail', false));
    service['registerProvider']('success-provider', () => makeProvider('success'));

    const result = await service.generateSummary('content');

    expect(result.summary).toBe('success');
    expect(result.success).toBe(true);
  });

  it('returns the last provider result when all providers fail', async () => {
    const service = createService([{ provider: 'fail1' }, { provider: 'fail2' }]);
    service['registerProvider']('fail1', () => makeProvider('fail1', false));
    service['registerProvider']('fail2', () => makeProvider('fail2', false));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(false);
    expect(result.summary).toBe('fail2');
  });

  it('deduplicates concurrent generateSummary calls for the same URL', async () => {
    const service = createService([{ provider: 'test' }]);
    let callCount = 0;
    service['registerProvider']('test', () => {
      callCount++;
      return makeProvider(`call-${callCount}`);
    });

    const [result1, result2] = await Promise.all([
      service.generateSummary('content', { url: 'https://example.com' }),
      service.generateSummary('content', { url: 'https://example.com' }),
    ]);

    expect(callCount).toBe(1);
    expect(result1).toBe(result2);
  });

  it('treats empty URL as non-dedupeable', async () => {
    const service = createService([{ provider: 'test' }]);
    let callCount = 0;
    service['registerProvider']('test', () => {
      callCount++;
      return makeProvider(`call-${callCount}`);
    });

    await Promise.all([
      service.generateSummary('content', { url: '' }),
      service.generateSummary('content', { url: '' }),
    ]);

    expect(callCount).toBe(2);
  });

  it('propagates provider exceptions as error results', async () => {
    const service = createService([{ provider: 'throw' }]);
    service['registerProvider']('throw', () => ({
      generateSummary: vi.fn().mockRejectedValue(new Error('provider error')),
      testConnection: vi.fn().mockResolvedValue({ success: true }),
    }));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(false);
    expect(result.summary).toContain('Error:');
  });

  it('propagates traceId to provider', async () => {
    const service = createService([{ provider: 'test' }]);
    const provider = makeProvider('ok');
    service['registerProvider']('test', () => provider);

    await service.generateSummary('content', { url: 'https://example.com', traceId: 'trace-123' });

    expect(provider.generateSummary).toHaveBeenCalledWith(
      'content',
      false,
      'trace-123',
    );
  });

  it('reports supported modes', () => {
    const service = createService([]);
    expect(service.getSupportedModes()).toEqual(['full_pipeline', 'masked_cloud']);
  });

  it('delegates testConnection to providers with progress callback', async () => {
    const service = createService([{ provider: 'test' }]);
    const onProgress = vi.fn();
    service['registerProvider']('test', () => makeProvider('ok'));

    const result = await service.testConnection(onProgress, 'run-1');

    expect(onProgress).toHaveBeenCalledWith({
      provider: 'test',
      model: undefined,
      index: 0,
      total: 1,
      runId: 'run-1',
    });
    expect(result.success).toBe(true);
  });
});
