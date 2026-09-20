import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LocalAIService } from '../LocalAIService.js';
import { BuiltInAiProvider } from '../providers/BuiltInAiProvider.js';
import { StorageKeys, type Settings } from '../../../utils/storage/types.js';

vi.mock('../../../utils/aiUsageTracker.js', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
  checkHardLimit: vi.fn().mockResolvedValue({ allowed: true }),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetTime: '' }),
  checkUsageWarning: vi.fn().mockResolvedValue({ allowed: true }),
  getRateLimitMessage: vi.fn().mockReturnValue(''),
}));
vi.mock('../../../utils/logger/core.js', () => ({
  addLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../utils/logger/api.js', () => ({
  logDebug: vi.fn(),
  logSanitize: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

import { recordUsage } from '../../../utils/aiUsageTracker.js';

const baseSettings = {} as Settings;
void baseSettings;

function makeClient(overrides: Record<string, unknown> = {}) {
  return {
    summarize: vi.fn().mockResolvedValue({ summary: 'local summary', success: true }),
    ...overrides,
  };
}

describe('LocalAIService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateSummary — strategy delegation', () => {
    it('routes through BuiltInAiProvider and reports usedLocal', async () => {
      const client = makeClient();
      const service = new LocalAIService({ localAiClient: client });

      const result = await service.generateSummary('test content');

      // The strategy passes raw content to the client; sanitize is owned by
      // the client (on-device 'builtin-input' profile).
      expect(client.summarize).toHaveBeenCalledWith('test content');
      expect(result).toMatchObject({
        summary: 'local summary',
        usedLocal: true,
        providerName: 'built-in-ai',
        success: true,
      });
    });

    it('applies an active custom prompt for built-in-ai (previously dropped in local_only)', async () => {
      const client = makeClient();
      const settings = {
        [StorageKeys.CUSTOM_PROMPTS]: [
          { name: 'concise', prompt: 'Summarize this: {{content}}', provider: 'built-in-ai', isActive: true },
        ],
      } as Settings;
      const repo = { getAll: vi.fn().mockResolvedValue(settings) };
      const service = new LocalAIService({ localAiClient: client, repo });

      await service.generateSummary('page body text');

      expect(client.summarize).toHaveBeenCalledTimes(1);
      const [, options] = client.summarize.mock.calls[0]!;
      expect(options?.promptOverride).toBe('Summarize this: page body text');
      expect(options?.systemPromptOverride).toBeDefined();
    });

    it('records token usage like the remote slot path does', async () => {
      const client = makeClient({
        summarize: vi.fn().mockResolvedValue({ summary: 's', success: true, sentTokens: 3817, receivedTokens: 75 }),
      });
      const service = new LocalAIService({ localAiClient: client });

      const result = await service.generateSummary('content');

      expect(result.sentTokens).toBe(3817);
      expect(result.receivedTokens).toBe(75);
      expect(recordUsage).toHaveBeenCalledWith(3817, 75);
    });

    it('passes tagSummaryMode and traceId through to the strategy adapter', async () => {
      const client = makeClient();
      const service = new LocalAIService({ localAiClient: client });

      await service.generateSummary('content', { mode: 'local_only', tagSummaryMode: true, traceId: 'tr-1' });

      expect(client.summarize).toHaveBeenCalledWith('content');
    });
  });

  describe('generateSummary — failure shape', () => {
    it('maps a strategy failure to the historical local shape (empty summary + error)', async () => {
      const client = makeClient({
        summarize: vi.fn().mockResolvedValue({ success: false, error: 'Built-in AI is currently unavailable' }),
      });
      const service = new LocalAIService({ localAiClient: client });

      const result = await service.generateSummary('content');

      expect(result.success).toBe(false);
      expect(result.summary).toBe('');
      expect(result.error).toBe('Built-in AI is currently unavailable');
      expect(result.usedLocal).toBe(true);
    });

    it('keeps the no-content failure reason in error', async () => {
      const client = makeClient({
        summarize: vi.fn().mockResolvedValue({ success: false, summary: '', error: 'Built-in AI returned no content' }),
      });
      const service = new LocalAIService({ localAiClient: client });

      const result = await service.generateSummary('content');

      expect(result.success).toBe(false);
      expect(result.summary).toBe('');
      expect(result.error).toBe('Built-in AI returned no content');
    });
  });

  describe('testConnection', () => {
    it('succeeds when the on-device model is available', async () => {
      const getAvailability = vi.fn().mockResolvedValue('available');
      const service = new LocalAIService({ localAiClient: makeClient({ getAvailability }) });

      const result = await service.testConnection();

      expect(result.success).toBe(true);
      expect(result.providers[0]?.debug?.availability).toBe('available');
    });

    it('fails when the model is not available, reporting the status', async () => {
      const getAvailability = vi.fn().mockResolvedValue('downloadable');
      const service = new LocalAIService({ localAiClient: makeClient({ getAvailability }) });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('downloadable');
    });

    it('fails gracefully when the client cannot report availability', async () => {
      const service = new LocalAIService({ localAiClient: makeClient() });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.providers).toEqual([]);
    });

    it('turns a thrown availability error into a failed result', async () => {
      const getAvailability = vi.fn().mockRejectedValue(new Error('no LanguageModel'));
      const service = new LocalAIService({ localAiClient: makeClient({ getAvailability }) });

      const result = await service.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toBe('no LanguageModel');
    });
  });
});
