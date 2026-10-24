/**
 * builtin-client-sharing.test.ts — PBI 2026-10-24-03 acceptance.
 * One shared BuiltInAIClient instance serves both the local path
 * (LocalAIService) and the provider-slot path (RemoteAIService via
 * createSharedBuiltInStrategy). The two adapters and their testConnection
 * meanings stay separate — only the instance is shared (ADR 2026-09-17
 * coexistence kept, no replacement ADR).
 */
import { describe, it, expect, vi } from 'vitest';
import { LocalAIService } from '../LocalAIService.js';
import { RemoteAIService } from '../RemoteAIService.js';
import { createSharedBuiltInStrategy } from '../aiServiceFactory.js';
import { BuiltInAiProvider } from '../providers/BuiltInAiProvider.js';
import type { BuiltInAIClient } from '../../builtInAIClient.js';
import type { Settings } from '../../../utils/storage/types.js';
import type { SettingsReader } from '../../../utils/storage/SettingsRepository.js';

vi.mock('../../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));
vi.mock('../../../utils/aiUsageTracker.js', () => ({
  recordUsage: vi.fn().mockResolvedValue(undefined),
  checkHardLimit: vi.fn().mockResolvedValue({ allowed: true }),
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, resetTime: '' }),
  checkUsageWarning: vi.fn().mockResolvedValue({ allowed: true }),
  getRateLimitMessage: vi.fn().mockReturnValue(''),
}));

function makeSharedClient() {
  return {
    summarize: vi.fn().mockResolvedValue({ success: true, summary: 'shared on-device summary' }),
    getAvailability: vi.fn().mockResolvedValue('available'),
  };
}

function makeRepo(settings: Record<string, unknown>): SettingsReader {
  return {
    getAll: vi.fn().mockResolvedValue(settings),
    getMany: vi.fn(),
  } as unknown as SettingsReader;
}

const builtInSlotSettings = {
  ai_provider_priority_list: [{ provider: 'built-in-ai' }],
  ai_provider: 'built-in-ai',
  summary_min_length: 0,
};

describe('builtinClientSharing', () => {
  describe('createSharedBuiltInStrategy', () => {
    it('pins the built-in-ai slot to the shared instance', async () => {
      const shared = makeSharedClient();
      const strategy = createSharedBuiltInStrategy(shared as unknown as BuiltInAIClient);

      const provider = strategy('built-in-ai', {} as Settings);
      expect(provider).toBeInstanceOf(BuiltInAiProvider);

      const result = await provider.generateSummary('slot content');

      expect(shared.summarize).toHaveBeenCalledWith('slot content');
      expect(result.summary).toBe('shared on-device summary');
    });
  });

  describe('both routes', () => {
    it('serve generateSummary from the same client instance', async () => {
      const shared = makeSharedClient();
      const local = new LocalAIService({ localAiClient: shared, repo: makeRepo({}) });
      const remote = new RemoteAIService({
        createStrategy: createSharedBuiltInStrategy(shared as unknown as BuiltInAIClient),
        repo: makeRepo(builtInSlotSettings),
      });

      const localResult = await local.generateSummary('page content');
      const remoteResult = await remote.generateSummary('page content');

      expect(shared.summarize).toHaveBeenCalledTimes(2);
      expect(localResult.summary).toBe('shared on-device summary');
      expect(localResult.usedLocal).toBe(true);
      expect(remoteResult.summary).toBe('shared on-device summary');
    });

    it('keep the two testConnection meanings while reading the same client', async () => {
      const shared = makeSharedClient();
      const local = new LocalAIService({ localAiClient: shared, repo: makeRepo({}) });
      const remote = new RemoteAIService({
        createStrategy: createSharedBuiltInStrategy(shared as unknown as BuiltInAIClient),
        repo: makeRepo(builtInSlotSettings),
      });

      const localConnection = await local.testConnection();
      const remoteConnection = await remote.testConnection();

      // Local path reports model availability; the slot path probes with a
      // real summarize call. Both succeed off the same shared instance.
      expect(localConnection.success).toBe(true);
      expect(localConnection.message).toBe('On-device model is available.');
      expect(shared.getAvailability).toHaveBeenCalledTimes(1);

      expect(remoteConnection.success).toBe(true);
      expect(remoteConnection.providers).toHaveLength(1);
      expect(remoteConnection.providers[0]?.provider).toBe('built-in-ai');
      expect(shared.summarize).toHaveBeenCalledTimes(1);
    });
  });
});
