/**
 * provider-single-seam.test.ts (PBI 2026-10-16-03 Red)
 * 生成入口が1本であることの契約:
 * - Remote内Map / public registerProvider が存在しない
 * - 生成関数1本注入 (既定 = createProviderStrategy)
 * - 未知idは本番seam経由で UnknownProviderError 契約になる
 */
import { describe, it, expect, vi } from 'vitest';
import { RemoteAIService } from '../RemoteAIService.js';
import {
  createProviderStrategy,
  UnknownProviderError,
} from '../providerCatalog.js';
import type { AIProviderStrategy } from '../providers/index.js';
import type { SettingsReader } from '../../../utils/storage/SettingsRepository.js';
import type { Settings } from '../../../utils/storage/types.js';

vi.mock('../../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));

function makeRepo(settings: Record<string, unknown>): SettingsReader {
  return {
    getAll: vi.fn().mockResolvedValue(settings),
    getMany: vi.fn(),
  };
}

function makeProvider(summary: string): AIProviderStrategy {
  return {
    generateSummary: vi.fn().mockResolvedValue({ success: true, summary }),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: summary }),
  } as unknown as AIProviderStrategy;
}

describe('PBI 2026-10-16-03 single seam (Red)', () => {
  it('Remoteにpublic registerProviderが存在しない', () => {
    const service = new RemoteAIService({ repo: makeRepo({}) });
    expect('registerProvider' in (service as unknown as Record<string, unknown>)).toBe(false);
  });

  it('未知idは本番seam経由でUnknownProviderError契約になる', async () => {
    expect(() => createProviderStrategy('no-such-provider', {} as Settings)).toThrow(
      UnknownProviderError,
    );
    const service = new RemoteAIService({
      repo: makeRepo({
        ai_provider_priority_list: [{ provider: 'no-such-provider' }],
        ai_provider: 'no-such-provider',
        summary_min_length: 0,
      }),
    });
    const result = await service.generateSummary('content');
    expect(result.success).toBe(false);
    expect(result.summary).toContain('AI provider configuration is missing');
  });

  it('偽Adapterは生成関数差し替えで入り、catalog欠落を検出できる', async () => {
    const fake = makeProvider('fake summary');
    const createStrategy = vi.fn((providerId: string, _settings: Settings) => {
      if (providerId === 'fake-id') return fake;
      return createProviderStrategy(providerId, _settings);
    });
    const service = new RemoteAIService({
      repo: makeRepo({
        ai_provider_priority_list: [{ provider: 'fake-id' }],
        ai_provider: 'fake-id',
        summary_min_length: 0,
      }),
      createStrategy,
    });
    const result = await service.generateSummary('content');
    expect(createStrategy).toHaveBeenCalledWith('fake-id', expect.anything());
    expect(result.summary).toBe('fake summary');
    // catalogに無いidは差し替え関数を通してもUnknownProviderErrorになる
    expect(() => createStrategy('missing-row', {} as Settings)).toThrow(UnknownProviderError);
  });

  it('testConnectionの未知idはUnknown providerメッセージになる', async () => {
    const service = new RemoteAIService({
      repo: makeRepo({
        ai_provider_priority_list: [{ provider: 'no-such-provider' }],
        ai_provider: 'no-such-provider',
      }),
    });
    const result = await service.testConnection();
    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown provider: no-such-provider');
  });
});
