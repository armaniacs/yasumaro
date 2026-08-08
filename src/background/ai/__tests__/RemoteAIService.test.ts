import { describe, it, expect, vi } from 'vitest';
import { RemoteAIService } from '../RemoteAIService.js';

/** Build the aiClient collaborator with a default no-op testConnection. */
function makeAiClient(generateSummary: ReturnType<typeof vi.fn>, testConnection = vi.fn()) {
  return { generateSummary, testConnection };
}

describe('RemoteAIService', () => {
  it('calls aiClient.generateSummary with content and options', async () => {
    const generateSummary = vi.fn().mockResolvedValue({
      summary: 'remote summary',
      sentTokens: 100,
      receivedTokens: 50,
      providerName: 'TestProvider',
      modelName: 'test-model',
    });
    const service = new RemoteAIService({ aiClient: makeAiClient(generateSummary) });

    const result = await service.generateSummary('test content', {
      tagSummaryMode: true,
      url: 'https://example.com',
    });

    expect(generateSummary).toHaveBeenCalledWith('test content', true, 'https://example.com', undefined);
    expect(result).toEqual({
      summary: 'remote summary',
      sentTokens: 100,
      receivedTokens: 50,
      providerName: 'TestProvider',
      modelName: 'test-model',
      success: undefined,
      error: undefined,
    });
  });

  it('works without optional options', async () => {
    const generateSummary = vi.fn().mockResolvedValue({ summary: 'plain summary' });
    const service = new RemoteAIService({ aiClient: makeAiClient(generateSummary) });

    const result = await service.generateSummary('test content');

    expect(generateSummary).toHaveBeenCalledWith('test content', undefined, undefined, undefined);
    expect(result.summary).toBe('plain summary');
  });

  it('propagates traceId to aiClient', async () => {
    const generateSummary = vi.fn().mockResolvedValue({ summary: 'remote summary' });
    const service = new RemoteAIService({ aiClient: makeAiClient(generateSummary) });

    await service.generateSummary('test content', {
      tagSummaryMode: false,
      url: 'https://example.com',
      traceId: 'trace-123',
    });

    expect(generateSummary).toHaveBeenCalledWith('test content', false, 'https://example.com', 'trace-123');
  });

  it('propagates errors from aiClient', async () => {
    const generateSummary = vi.fn().mockRejectedValue(new Error('api error'));
    const service = new RemoteAIService({ aiClient: makeAiClient(generateSummary) });

    await expect(service.generateSummary('test content')).rejects.toThrow('api error');
  });

  it('reports supported modes', () => {
    const service = new RemoteAIService({ aiClient: makeAiClient(vi.fn()) });

    expect(service.getSupportedModes()).toEqual(['full_pipeline', 'masked_cloud']);
  });

  // Regression: success/error used to be dropped here, so FallbackAIService's
  // 'auto' branch (which keys on `success === false`) read every remote failure
  // as `undefined` and treated it as a success.
  it('forwards success and error from aiClient', async () => {
    const generateSummary = vi.fn().mockResolvedValue({
      summary: 'Error: quota exceeded',
      success: false,
      error: 'quota exceeded',
    });
    const service = new RemoteAIService({ aiClient: makeAiClient(generateSummary) });

    const result = await service.generateSummary('test content');

    expect(result.success).toBe(false);
    expect(result.error).toBe('quota exceeded');
  });

  it('delegates testConnection to aiClient with progress callback and runId', async () => {
    const testConnection = vi.fn().mockResolvedValue({
      success: true,
      message: 'ok',
      providers: [],
    });
    const service = new RemoteAIService({ aiClient: makeAiClient(vi.fn(), testConnection) });
    const onProgress = vi.fn();

    const result = await service.testConnection(onProgress, 'run-1');

    expect(testConnection).toHaveBeenCalledWith(onProgress, 'run-1');
    expect(result.success).toBe(true);
  });
});
