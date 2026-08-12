/**
 * aiClient.test.ts
 * AIClient は RemoteAIService への薄い委譲ラッパー。
 * ここでは委譲そのものが正しく行われることのみを検証し、
 * RemoteAIService の実装詳細（優先度フォールバック、エラー整形等）は
 * ai/__tests__/RemoteAIService.test.ts が担当する。
 */

import { describe, it, expect, vi } from 'vitest';
import { AIClient } from '../aiClient.js';
import { RemoteAIService } from '../ai/RemoteAIService.js';

describe('AIClient: RemoteAIServiceへの委譲', () => {
  it('generateSummaryをremoteAiServiceに委譲する', async () => {
    const remoteAiService = new RemoteAIService();
    const spy = vi
      .spyOn(remoteAiService, 'generateSummary')
      .mockResolvedValue({ success: true, summary: 'delegated summary' });
    const client = new AIClient(remoteAiService);

    const result = await client.generateSummary('content', true, 'https://example.com', 'trace-1');

    expect(spy).toHaveBeenCalledWith('content', {
      tagSummaryMode: true,
      url: 'https://example.com',
      traceId: 'trace-1',
    });
    expect(result.summary).toBe('delegated summary');
  });

  it('testConnectionをremoteAiServiceに委譲する', async () => {
    const remoteAiService = new RemoteAIService();
    const spy = vi
      .spyOn(remoteAiService, 'testConnection')
      .mockResolvedValue({ success: true, message: 'ok', providers: [] });
    const client = new AIClient(remoteAiService);
    const onProgress = vi.fn();

    const result = await client.testConnection(onProgress, 'run-1');

    expect(spy).toHaveBeenCalledWith(onProgress, 'run-1');
    expect(result.success).toBe(true);
  });

  it('registerProviderをremoteAiServiceに委譲する', () => {
    const remoteAiService = new RemoteAIService();
    const spy = vi.spyOn(remoteAiService, 'registerProvider');
    const client = new AIClient(remoteAiService);
    const factory = vi.fn();

    client.registerProvider('custom', factory);

    expect(spy).toHaveBeenCalledWith('custom', factory);
  });

  it('remoteAiServiceを渡さない場合はデフォルトでRemoteAIServiceを生成する', () => {
    const client = new AIClient();

    expect(client.remoteAiService).toBeInstanceOf(RemoteAIService);
  });
});
