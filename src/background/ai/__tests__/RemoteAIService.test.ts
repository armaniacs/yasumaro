import { describe, it, expect, vi } from 'vitest';
import { RemoteAIService } from '../RemoteAIService.js';

describe('RemoteAIService', () => {
  it('calls aiClient.generateSummary with content and options', async () => {
    const generateSummary = vi.fn().mockResolvedValue({
      summary: 'remote summary',
      sentTokens: 100,
      receivedTokens: 50,
      providerName: 'TestProvider',
      model: 'test-model',
    });
    const service = new RemoteAIService({ aiClient: { generateSummary } });

    const result = await service.generateSummary('test content', {
      tagSummaryMode: true,
      url: 'https://example.com',
    });

    expect(generateSummary).toHaveBeenCalledWith('test content', true, 'https://example.com');
    expect(result).toEqual({
      summary: 'remote summary',
      sentTokens: 100,
      receivedTokens: 50,
      providerName: 'TestProvider',
      modelName: 'test-model',
    });
  });

  it('works without optional options', async () => {
    const generateSummary = vi.fn().mockResolvedValue({ summary: 'plain summary' });
    const service = new RemoteAIService({ aiClient: { generateSummary } });

    const result = await service.generateSummary('test content');

    expect(generateSummary).toHaveBeenCalledWith('test content', undefined, undefined);
    expect(result.summary).toBe('plain summary');
  });

  it('propagates errors from aiClient', async () => {
    const generateSummary = vi.fn().mockRejectedValue(new Error('api error'));
    const service = new RemoteAIService({ aiClient: { generateSummary } });

    await expect(service.generateSummary('test content')).rejects.toThrow('api error');
  });

  it('reports supported modes', () => {
    const service = new RemoteAIService({ aiClient: { generateSummary: vi.fn() } });

    expect(service.getSupportedModes()).toEqual(['full_pipeline', 'masked_cloud']);
  });
});
