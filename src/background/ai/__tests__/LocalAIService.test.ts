import { describe, it, expect, vi } from 'vitest';
import { LocalAIService } from '../LocalAIService.js';

describe('LocalAIService', () => {
  it('calls localAiClient.summarize and returns summary with usedLocal flag', async () => {
    const summarize = vi.fn().mockResolvedValue({ summary: 'local summary' });
    const service = new LocalAIService({ localAiClient: { summarize } });

    const result = await service.generateSummary('test content');

    expect(summarize).toHaveBeenCalledWith('test content');
    expect(result).toEqual({ summary: 'local summary', usedLocal: true });
  });

  it('defaults summary to empty string when missing', async () => {
    const summarize = vi.fn().mockResolvedValue({});
    const service = new LocalAIService({ localAiClient: { summarize } });

    const result = await service.generateSummary('test content');

    expect(result.summary).toBe('');
    expect(result.usedLocal).toBe(true);
  });

  it('calls ensureOffscreenDocument when provided', async () => {
    const summarize = vi.fn().mockResolvedValue({ summary: 'summary' });
    const ensureOffscreenDocument = vi.fn().mockResolvedValue(undefined);
    const service = new LocalAIService({
      localAiClient: { summarize },
      ensureOffscreenDocument,
    });

    await service.generateSummary('test content');

    expect(ensureOffscreenDocument).toHaveBeenCalled();
  });

  it('does not call ensureOffscreenDocument when omitted', async () => {
    const summarize = vi.fn().mockResolvedValue({ summary: 'summary' });
    const service = new LocalAIService({ localAiClient: { summarize } });

    await service.generateSummary('test content');

    // ensureOffscreenDocument is optional; no error and summarize still called.
    expect(summarize).toHaveBeenCalled();
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
});
