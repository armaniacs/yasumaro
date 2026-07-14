import { vi } from 'vitest';
import { FallbackAIService } from '../FallbackAIService.js';
import { type AIService, type AISummaryResult } from '../AIService.js';

function mockAIService(results: Partial<AISummaryResult>): AIService {
  return {
    generateSummary: vi.fn().mockResolvedValue({ summary: 'test', ...results }),
    getSupportedModes: vi.fn().mockReturnValue(['full_pipeline']),
  };
}

describe('FallbackAIService', () => {
  test('uses local when available', async () => {
    const local = mockAIService({ summary: 'local summary', usedLocal: true });
    (local.getSupportedModes as ReturnType<typeof vi.fn>).mockReturnValue(['local_only']);
    const remote = mockAIService({ summary: 'remote summary' });
    const fallback = new FallbackAIService({ local, remote });

    const result = await fallback.generateSummary('test content', { mode: 'auto' });
    expect(result.summary).toBe('local summary');
    expect(remote.generateSummary).not.toHaveBeenCalled();
  });

  test('falls back to remote when local unavailable', async () => {
    const local: AIService = {
      generateSummary: vi.fn().mockRejectedValue(new Error('unavailable')),
      getSupportedModes: vi.fn().mockReturnValue([]),
    };
    const remote = mockAIService({ summary: 'remote fallback' });
    const fallback = new FallbackAIService({ local, remote });

    const result = await fallback.generateSummary('test content', { mode: 'auto' });
    expect(result.summary).toBe('remote fallback');
  });

  test('explicit mode bypasses fallback logic', async () => {
    const local = mockAIService({ summary: 'local' });
    const remote = mockAIService({ summary: 'remote' });
    const fallback = new FallbackAIService({ local, remote });

    const result = await fallback.generateSummary('test', { mode: 'full_pipeline' });
    expect(result.summary).toBe('remote');
    expect(local.generateSummary).not.toHaveBeenCalled();
  });

  test('errors when both fail', async () => {
    const local: AIService = {
      generateSummary: vi.fn().mockRejectedValue(new Error('local down')),
      getSupportedModes: vi.fn().mockReturnValue([]),
    };
    const remote: AIService = {
      generateSummary: vi.fn().mockRejectedValue(new Error('remote down')),
      getSupportedModes: vi.fn().mockReturnValue([]),
    };
    const fallback = new FallbackAIService({ local, remote });
    await expect(fallback.generateSummary('test', { mode: 'auto' })).rejects.toThrow();
  });

  test('getSupportedModes returns union of both', () => {
    const local = mockAIService();
    const remote = mockAIService();
    (local.getSupportedModes as ReturnType<typeof vi.fn>).mockReturnValue(['local_only']);
    (remote.getSupportedModes as ReturnType<typeof vi.fn>).mockReturnValue(['full_pipeline', 'masked_cloud']);
    const fallback = new FallbackAIService({ local, remote });
    const modes = fallback.getSupportedModes();
    expect(modes).toContain('local_only');
    expect(modes).toContain('full_pipeline');
    expect(modes).toContain('masked_cloud');
  });
});
