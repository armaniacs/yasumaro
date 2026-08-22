import { describe, it, expect, vi } from 'vitest';
import { RemoteAIService } from '../RemoteAIService.js';
import { AIProviderStrategy } from '../providers/index.js';
import { recordAuditLog } from '../../../utils/auditLog.js';
import type { SettingsReader } from '../../../utils/storage/SettingsRepository.js';

vi.mock('../../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));

function makeProvider(summary: string, success = true): AIProviderStrategy {
  return {
    generateSummary: vi.fn().mockResolvedValue({ success, summary }),
    testConnection: vi.fn().mockResolvedValue({ success, message: summary }),
  };
}

function makeRepo(settings: Record<string, unknown>): SettingsReader {
  return {
    getAll: vi.fn().mockResolvedValue(settings),
    getMany: vi.fn(),
  };
}

function createService(providerSlots: Array<{ provider: string }>, settingsOverride?: Record<string, unknown>) {
  const settings = settingsOverride ?? {
    ai_provider_priority_list: providerSlots,
    ai_provider: 'gemini',
    summary_min_length: 0,
  };
  return new RemoteAIService({ repo: makeRepo(settings) });
}

describe('RemoteAIService', () => {
  it('delegates generateSummary to the first successful provider', async () => {
    const service = createService([{ provider: 'test-provider' }]);
    service.registerProvider('test-provider', () => makeProvider('test summary'));

    const result = await service.generateSummary('content', { url: 'https://example.com' });

    expect(result.summary).toBe('test summary');
    expect(result.success).toBe(true);
  });

  it('falls back to the next provider when the first fails', async () => {
    const service = createService([{ provider: 'fail-provider' }, { provider: 'success-provider' }]);
    service.registerProvider('fail-provider', () => makeProvider('fail', false));
    service.registerProvider('success-provider', () => makeProvider('success'));

    const result = await service.generateSummary('content');

    expect(result.summary).toBe('success');
    expect(result.success).toBe(true);
  });

  it('returns the last provider result when all providers fail', async () => {
    const service = createService([{ provider: 'fail1' }, { provider: 'fail2' }]);
    service.registerProvider('fail1', () => makeProvider('fail1', false));
    service.registerProvider('fail2', () => makeProvider('fail2', false));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(false);
    expect(result.summary).toBe('fail2');
  });

  it('deduplicates concurrent generateSummary calls for the same URL', async () => {
    const service = createService([{ provider: 'test' }]);
    let callCount = 0;
    service.registerProvider('test', () => {
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
    service.registerProvider('test', () => {
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
    service.registerProvider('throw', () => ({
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
    service.registerProvider('test', () => provider);

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
    service.registerProvider('test', () => makeProvider('ok'));

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

  it('未知のプロバイダーの場合、設定不備エラーを返す', async () => {
    const service = createService([{ provider: 'unknown-provider' }]);

    const result = await service.generateSummary('content');

    expect(result.success).toBe(false);
    expect(result.summary).toContain('Error:');
    expect(result.summary).not.toContain('unknown-provider');
    expect(result.summary).toContain('AI provider configuration is missing');
    expect(result.summary).toContain('check your settings');
  });

  it('registerProviderで登録したカスタムプロバイダーが実際に呼ばれる', async () => {
    const service = createService([{ provider: 'custom' }]);
    const customProvider = makeProvider('custom summary');
    service.registerProvider('custom', () => customProvider);

    const result = await service.generateSummary('content');

    expect(customProvider.generateSummary).toHaveBeenCalled();
    expect(result.summary).toBe('custom summary');
  });

  it('異なるURLへの並行呼び出しはそれぞれ独立してAPIを呼び出す', async () => {
    const service = createService([{ provider: 'test' }]);
    let callCount = 0;
    service.registerProvider('test', () => {
      callCount++;
      return makeProvider(`summary-${callCount}`);
    });

    await Promise.all([
      service.generateSummary('content', { url: 'https://example.com/a' }),
      service.generateSummary('content', { url: 'https://example.com/b' }),
    ]);

    expect(callCount).toBe(2);
  });

  it('完了後は同一URLへの新規呼び出しで再度APIが呼ばれる', async () => {
    const service = createService([{ provider: 'test' }]);
    let callCount = 0;
    service.registerProvider('test', () => {
      callCount++;
      return makeProvider('ok');
    });

    const url = 'https://example.com/article';
    await service.generateSummary('content', { url });
    expect(callCount).toBe(1);

    await service.generateSummary('content', { url });
    expect(callCount).toBe(2);
  });

  it('失敗時もin-flightマップから削除され、次の呼び出しで再試行できる', async () => {
    const service = createService([{ provider: 'fail' }]);
    let callCount = 0;
    service.registerProvider('fail', () => ({
      generateSummary: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.reject(new Error('API error'));
      }),
      testConnection: vi.fn().mockResolvedValue({ success: true }),
    }));

    const url = 'https://example.com/article';
    await service.generateSummary('content', { url });
    expect(callCount).toBe(1);

    await service.generateSummary('content', { url });
    expect(callCount).toBe(2);
  });

  it('testConnection: 未知のプロバイダーでエラーを返す', async () => {
    const service = createService([{ provider: 'unknown' }]);

    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown provider: unknown');
  });

  it('testConnection: プロバイダーがthrowした場合エラー結果を返す', async () => {
    const service = createService([{ provider: 'throwing' }]);
    service.registerProvider('throwing', () => ({
      generateSummary: vi.fn().mockResolvedValue({ success: true, summary: 'ok' }),
      testConnection: vi.fn().mockRejectedValue(new Error('Connection test internal error')),
    }));

    const result = await service.testConnection();

    expect(result.success).toBe(false);
    expect(result.providers[0].message).toContain('Connection test internal error');
  });

  it('testConnection: 各プロバイダーの結果に非負のelapsedMsを含める', async () => {
    const service = createService([{ provider: 'a' }, { provider: 'b' }]);
    service.registerProvider('a', () => makeProvider('ok-a'));
    service.registerProvider('b', () => makeProvider('ok-b'));

    const result = await service.testConnection();

    expect(result.providers.length).toBe(2);
    for (const provider of result.providers) {
      expect(typeof provider.elapsedMs).toBe('number');
      expect(Number.isNaN(provider.elapsedMs)).toBe(false);
      expect(provider.elapsedMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('testConnection: 未知のプロバイダーの結果にもelapsedMsを含める', async () => {
    const service = createService([{ provider: 'unknown' }]);

    const result = await service.testConnection();

    expect(result.providers).toHaveLength(1);
    expect(typeof result.providers[0].elapsedMs).toBe('number');
    expect(result.providers[0].elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('generateSummary前にrecordAuditLogをprovider名とurlで呼ぶ', async () => {
    const service = createService([{ provider: 'test' }]);
    service.registerProvider('test', () => makeProvider('ok'));

    await service.generateSummary('content', { url: 'https://example.com/audit-test' });

    expect(recordAuditLog).toHaveBeenCalledWith({ provider: 'test', url: 'https://example.com/audit-test' });
  });

  it('フォールバック中は試行した各プロバイダーについてrecordAuditLogが呼ばれる', async () => {
    const service = createService([{ provider: 'fail' }, { provider: 'success' }]);
    service.registerProvider('fail', () => makeProvider('fail', false));
    service.registerProvider('success', () => makeProvider('success'));

    await service.generateSummary('content', { url: 'https://example.com/fallback-test' });

    expect(recordAuditLog).toHaveBeenCalledWith({ provider: 'fail', url: 'https://example.com/fallback-test' });
    expect(recordAuditLog).toHaveBeenCalledWith({ provider: 'success', url: 'https://example.com/fallback-test' });
  });

  it('プロバイダーがthrowした場合、内部エラーメッセージを含まない汎用メッセージを返す', async () => {
    const service = createService([{ provider: 'throwing' }]);
    service.registerProvider('throwing', () => ({
      generateSummary: vi.fn().mockRejectedValue(new Error('Provider internal error')),
      testConnection: vi.fn().mockResolvedValue({ success: true }),
    }));

    const result = await service.generateSummary('content');

    expect(result.summary).toContain('Error:');
    expect(result.summary).toContain('Failed to generate summary');
    expect(result.summary).not.toContain('Provider internal error');
  });

  it('MAX_PROVIDERS(10)を超えるスロットは切り捨てられる', async () => {
    const slots = Array.from({ length: 30 }, (_, i) => ({ provider: 'test', model: `model-${i}` }));
    const service = createService(slots);
    let callCount = 0;
    service.registerProvider('test', () => {
      callCount++;
      return makeProvider('ok');
    });

    const result = await service.testConnection();

    expect(callCount).toBeLessThanOrEqual(10);
    expect(result.providers.length).toBeLessThanOrEqual(10);
  });

  it('要約が最小長未満の場合、次のプロバイダーにフォールバックする', async () => {
    const service = new RemoteAIService({
      repo: makeRepo({
        ai_provider_priority_list: [{ provider: 'short' }, { provider: 'long' }],
        summary_min_length: 20,
      }),
    });
    service.registerProvider('short', () => makeProvider('短い'));
    service.registerProvider('long', () => makeProvider('これは20文字以上ある十分な長さの要約結果テキストです。'));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(true);
    expect(result.summary).toContain('20文字以上');
  });

  it('優先度リストが空配列の場合、旧AI_PROVIDER単一設定にフォールバックする', async () => {
    const service = new RemoteAIService({
      repo: makeRepo({
        ai_provider_priority_list: [],
        ai_provider: 'legacy',
        summary_min_length: 0,
      }),
    });
    service.registerProvider('legacy', () => makeProvider('legacy summary'));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(true);
    expect(result.summary).toBe('legacy summary');
  });

  it('優先度リストとAI_PROVIDERが欠損の場合、DEFAULT_SETTINGSのopenaiにフォールバックする', async () => {
    const service = new RemoteAIService({
      repo: makeRepo({
        ai_provider_priority_list: [],
        summary_min_length: 0,
      }),
    });
    service.registerProvider('openai', () => makeProvider('openai summary'));

    const result = await service.generateSummary('content');

    expect(result.success).toBe(true);
    expect(result.summary).toBe('openai summary');
  });

  it('優先度リストの各プロバイダー開始時にonProgressが順番に呼ばれる', async () => {
    const service = createService([{ provider: 'a' }, { provider: 'b', model: 'model-b' }]);
    service.registerProvider('a', () => makeProvider('ok-a'));
    service.registerProvider('b', () => makeProvider('ok-b'));
    const onProgress = vi.fn();

    await service.testConnection(onProgress);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, { provider: 'a', model: undefined, index: 0, total: 2 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { provider: 'b', model: 'model-b', index: 1, total: 2 });
  });

  it('スロットにmodel未指定でも、設定済みデフォルトモデルを解決してonProgressに渡す', async () => {
    const service = new RemoteAIService({
      repo: makeRepo({
        ai_provider_priority_list: [{ provider: 'gemini' }],
        gemini_model: 'gemini-3.1-flash-lite',
      }),
    });
    service.registerProvider('gemini', () => makeProvider('ok'));
    const onProgress = vi.fn();

    await service.testConnection(onProgress);

    expect(onProgress).toHaveBeenNthCalledWith(1, {
      provider: 'gemini',
      model: 'gemini-3.1-flash-lite',
      index: 0,
      total: 1,
    });
  });

  it('onProgressを省略しても従来通り動作する', async () => {
    const service = createService([{ provider: 'a' }]);
    service.registerProvider('a', () => makeProvider('ok'));

    const result = await service.testConnection();

    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });
});
