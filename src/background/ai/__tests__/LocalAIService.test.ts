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
      success: true,
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

  describe('testConnection', () => {
    it('succeeds when the on-device model is available', async () => {
      const getAvailability = vi.fn().mockResolvedValue('available');
      const service = new LocalAIService({ localAiClient: { summarize: vi.fn(), getAvailability } });

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.providers[0]?.debug?.availability).toBe('available');
    });

    it('fails when the model is not available, reporting the status', async () => {
      const getAvailability = vi.fn().mockResolvedValue('downloadable');
      const service = new LocalAIService({ localAiClient: { summarize: vi.fn(), getAvailability } });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('downloadable');
    });

    it('fails gracefully when the client cannot report availability', async () => {
      const service = new LocalAIService({ localAiClient: { summarize: vi.fn() } });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.providers).toEqual([]);
    });

    it('turns a thrown availability error into a failed result', async () => {
      const getAvailability = vi.fn().mockRejectedValue(new Error('no LanguageModel'));
      const service = new LocalAIService({ localAiClient: { summarize: vi.fn(), getAvailability } });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('no LanguageModel');
    });
  });
});
