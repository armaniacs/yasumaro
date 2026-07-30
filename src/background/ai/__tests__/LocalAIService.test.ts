import { describe, it, expect, vi } from 'vitest';
import { LocalAIService } from '../LocalAIService.js';

describe('LocalAIService', () => {
  it('calls localAiClient.summarize and returns summary with usedLocal flag', async () => {
    const summarize = vi.fn().mockResolvedValue({ summary: 'local summary' });
    const service = new LocalAIService({ localAiClient: { summarize } });

    const result = await service.generateSummary('test content');

    expect(summarize).toHaveBeenCalledWith('test content');
    expect(result).toEqual({
      summary: 'local summary',
      usedLocal: true,
      sentTokens: undefined,
      receivedTokens: undefined,
      providerName: 'built-in-ai',
      success: undefined,
      error: undefined,
    });
  });

  it('propagates success flag from localAiClient', async () => {
    const summarize = vi.fn().mockResolvedValue({ summary: 'local summary', success: true });
    const service = new LocalAIService({ localAiClient: { summarize } });

    const result = await service.generateSummary('test content');

    expect(result.success).toBe(true);
    expect(result.summary).toBe('local summary');
  });

  it('propagates success:false and error from localAiClient', async () => {
    const summarize = vi.fn().mockResolvedValue({ summary: '', success: false, error: 'Built-in AI is currently downloadable' });
    const service = new LocalAIService({ localAiClient: { summarize } });

    const result = await service.generateSummary('test content');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Built-in AI is currently downloadable');
    expect(result.summary).toBe('');
  });

  it('defaults summary to empty string when missing', async () => {
    const summarize = vi.fn().mockResolvedValue({});
    const service = new LocalAIService({ localAiClient: { summarize } });

    const result = await service.generateSummary('test content');

    expect(result.summary).toBe('');
    expect(result.usedLocal).toBe(true);
  });

  it('propagates errors from localAiClient', async () => {
    const summarize = vi.fn().mockRejectedValue(new Error('local ai unavailable'));
    const service = new LocalAIService({ localAiClient: { summarize } });

    await expect(service.generateSummary('test content')).rejects.toThrow('local ai unavailable');
  });

  it('reports supported modes', () => {
    const service = new LocalAIService({ localAiClient: { summarize: vi.fn() } });

    expect(service.getSupportedModes()).toEqual(['local_only']);
  });

  it('propagates sentTokens/receivedTokens from localAiClient', async () => {
    const summarize = vi.fn().mockResolvedValue({ summary: 'summary', sentTokens: 3817, receivedTokens: 75 });
    const service = new LocalAIService({ localAiClient: { summarize } });

    const result = await service.generateSummary('test content');

    expect(result.sentTokens).toBe(3817);
    expect(result.receivedTokens).toBe(75);
  });

  it('reports a fixed providerName so history entries show the AI source', async () => {
    const summarize = vi.fn().mockResolvedValue({ summary: 'summary' });
    const service = new LocalAIService({ localAiClient: { summarize } });

    const result = await service.generateSummary('test content');

    expect(result.providerName).toBe('built-in-ai');
  });

  it('omits sentTokens/receivedTokens when localAiClient does not provide them', async () => {
    const summarize = vi.fn().mockResolvedValue({ summary: 'summary' });
    const service = new LocalAIService({ localAiClient: { summarize } });

    const result = await service.generateSummary('test content');

    expect(result.sentTokens).toBeUndefined();
    expect(result.receivedTokens).toBeUndefined();
  });
});
