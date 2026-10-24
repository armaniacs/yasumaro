import { vi } from 'vitest';
import { FallbackAIService } from '../FallbackAIService.js';
import {
  type AIService,
  type AiConnectionTestResult,
  type AISummaryMode,
  type AISummaryResult,
} from '../AIService.js';

function mockAIService(results: Partial<AISummaryResult> = {}): AIService {
  return {
    generateSummary: vi.fn().mockResolvedValue({ summary: 'test', ...results }),
    getSupportedModes: vi.fn().mockReturnValue(['full_pipeline']),
    testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok', providers: [] }),
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
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok', providers: [] }),
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

  test('falls back to remote when local returns success:false', async () => {
    const local: AIService = {
      generateSummary: vi.fn().mockResolvedValue({ summary: 'local failed', success: false }),
      getSupportedModes: vi.fn().mockReturnValue(['local_only']),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok', providers: [] }),
    };
    const remote = mockAIService({ summary: 'remote fallback' });
    const fallback = new FallbackAIService({ local, remote });

    const result = await fallback.generateSummary('test content', { mode: 'auto' });
    expect(result.summary).toBe('remote fallback');
    expect(local.generateSummary).toHaveBeenCalledTimes(1);
    expect(remote.generateSummary).toHaveBeenCalledTimes(1);
  });

  test('errors when both fail', async () => {
    const local: AIService = {
      generateSummary: vi.fn().mockRejectedValue(new Error('local down')),
      getSupportedModes: vi.fn().mockReturnValue([]),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok', providers: [] }),
    };
    const remote: AIService = {
      generateSummary: vi.fn().mockRejectedValue(new Error('remote down')),
      getSupportedModes: vi.fn().mockReturnValue([]),
      testConnection: vi.fn().mockResolvedValue({ success: true, message: 'ok', providers: [] }),
    };
    const fallback = new FallbackAIService({ local, remote });
    await expect(fallback.generateSummary('test', { mode: 'auto' })).rejects.toThrow();
  });

  describe('testConnection', () => {
    function connectionResult(message: string, providers: AiConnectionTestResult['providers']): AiConnectionTestResult {
      const success = providers.some((provider) => provider.success);
      return { success, message, providers };
    }

    const routingCases: { mode: AISummaryMode | undefined; localCalls: number; remoteCalls: number }[] = [
      { mode: 'local_only', localCalls: 1, remoteCalls: 0 },
      { mode: 'full_pipeline', localCalls: 0, remoteCalls: 1 },
      { mode: 'masked_cloud', localCalls: 0, remoteCalls: 1 },
      { mode: 'auto', localCalls: 1, remoteCalls: 1 },
      { mode: undefined, localCalls: 1, remoteCalls: 1 },
    ];

    test.each(routingCases)('routes mode $mode to the matching route', async ({ mode, localCalls, remoteCalls }) => {
      const local = mockAIService({});
      const remote = mockAIService({});
      const fallback = new FallbackAIService({ local, remote });

      await fallback.testConnection(undefined, undefined, mode === undefined ? undefined : { mode });

      expect(local.testConnection).toHaveBeenCalledTimes(localCalls);
      expect(remote.testConnection).toHaveBeenCalledTimes(remoteCalls);
    });

    test('explicit local_only forwards progress and runId to local only', async () => {
      const local = mockAIService({});
      const remote = mockAIService({});
      (local.testConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
        connectionResult('local availability', [{
          provider: 'built-in-ai',
          success: true,
          message: 'availability=available',
          elapsedMs: 0,
          debug: { availability: 'available' },
        }]),
      );
      const fallback = new FallbackAIService({ local, remote });
      const onProgress = vi.fn();

      const result = await fallback.testConnection(onProgress, 'run-9', { mode: 'local_only' });

      expect(local.testConnection).toHaveBeenCalledWith(onProgress, 'run-9');
      expect(remote.testConnection).not.toHaveBeenCalled();
      expect(result.message).toBe('local availability');
    });

    test('explicit remote mode forwards progress and runId to remote only', async () => {
      const local = mockAIService({});
      const remote = mockAIService({});
      (remote.testConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
        connectionResult('remote reachable', [{
          provider: 'openai',
          success: true,
          message: 'ok',
          elapsedMs: 0,
        }]),
      );
      const fallback = new FallbackAIService({ local, remote });
      const onProgress = vi.fn();

      const result = await fallback.testConnection(onProgress, 'run-9', { mode: 'full_pipeline' });

      expect(remote.testConnection).toHaveBeenCalledWith(onProgress, 'run-9');
      expect(local.testConnection).not.toHaveBeenCalled();
      expect(result.message).toBe('remote reachable');
    });

    test('combined diagnosis merges both routes without reinterpreting them', async () => {
      const local = mockAIService({});
      const remote = mockAIService({});
      (local.testConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
        connectionResult('availability=downloadable', [{
          provider: 'built-in-ai',
          success: false,
          message: 'availability=downloadable',
          elapsedMs: 0,
          debug: { availability: 'downloadable' },
        }]),
      );
      (remote.testConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
        connectionResult('openai: OK', [{
          provider: 'openai',
          success: true,
          message: 'ok',
          elapsedMs: 0,
        }]),
      );
      const fallback = new FallbackAIService({ local, remote });

      const result = await fallback.testConnection();

      expect(result.success).toBe(true);
      expect(result.providers.map((provider) => provider.provider)).toEqual(['built-in-ai', 'openai']);
      expect(result.providers[0]?.debug).toEqual({ availability: 'downloadable' });
      expect(result.message).toContain('availability=downloadable');
      expect(result.message).toContain('openai: OK');
    });

    test('combined diagnosis fails only when both routes fail', async () => {
      const local = mockAIService({});
      const remote = mockAIService({});
      (local.testConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
        connectionResult('availability=unavailable', [{
          provider: 'built-in-ai',
          success: false,
          message: 'availability=unavailable',
          elapsedMs: 0,
          debug: { availability: 'unavailable' },
        }]),
      );
      (remote.testConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
        connectionResult('openai: bad key', [{
          provider: 'openai',
          success: false,
          message: 'bad key',
          elapsedMs: 0,
        }]),
      );
      const fallback = new FallbackAIService({ local, remote });

      const result = await fallback.testConnection(undefined, undefined, { mode: 'auto' });

      expect(result.success).toBe(false);
      expect(result.providers).toHaveLength(2);
    });

    test('a throwing route becomes a failed result without losing the other route', async () => {
      const local: AIService = {
        generateSummary: vi.fn(),
        getSupportedModes: vi.fn().mockReturnValue(['local_only']),
        testConnection: vi.fn().mockRejectedValue(new Error('local exploded')),
      };
      const remote = mockAIService({});
      (remote.testConnection as ReturnType<typeof vi.fn>).mockResolvedValue(
        connectionResult('openai: OK', [{
          provider: 'openai',
          success: true,
          message: 'ok',
          elapsedMs: 0,
        }]),
      );
      const fallback = new FallbackAIService({ local, remote });

      const result = await fallback.testConnection();

      expect(result.success).toBe(true);
      expect(result.providers.map((provider) => provider.provider)).toEqual(['openai']);
      expect(result.message).toContain('local exploded');
    });
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
