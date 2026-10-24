/**
 * builtin-client-sharing.test.ts — PBI 2026-10-24-03 manifest acceptance.
 * The manifest registers one shared `builtInAiClient` singleton and flows
 * that same instance into the factory (`builtInAiClient` option) and the
 * slot generation seam. Both adapters and their testConnection meanings
 * stay separate — only the instance is shared (ADR 2026-09-17 kept).
 */
import { describe, it, expect, vi } from 'vitest';
import { compositionManifest } from '../compositionManifest.js';
import { ServiceContainer, type ServiceKey } from '../serviceContainer.js';
import type { SessionStorePort } from '../sessionStore.js';
import { RemoteAIService } from '../ai/RemoteAIService.js';
import type { LocalAIService } from '../ai/LocalAIService.js';
import type { AIService } from '../ai/AIService.js';
import type { CreateProviderStrategyFn } from '../ai/providerCatalog.js';
import type { Settings } from '../../utils/storage/types.js';
import type { BuiltInAIClient } from '../builtInAIClient.js';

vi.mock('../../utils/auditLog.js', () => ({ recordAuditLog: vi.fn() }));

function memoryStore(): SessionStorePort {
  const data = new Map<string, unknown>();
  return {
    get: async <T,>(key: string): Promise<T | null> => (data.has(key) ? (data.get(key) as T) : null),
    set: async (key: string, value: unknown): Promise<void> => {
      data.set(key, value);
    },
    remove: (key: string): void => {
      data.delete(key);
    },
  };
}

function registerSubset(container: ServiceContainer, keys: string[]): void {
  for (const entry of compositionManifest) {
    if (keys.includes(entry.key)) {
      container.register(entry.key as ServiceKey, () => entry.factory(container), {
        singleton: entry.singleton,
      });
    }
  }
}

describe('builtinClientSharingManifest', () => {
  describe('builtInAiClient entry', () => {
    it('registers the shared client as a singleton entry', () => {
      const keys = compositionManifest.map((entry) => entry.key);
      expect(keys).toContain('builtInAiClient');

      const entry = compositionManifest.find((e) => e.key === 'builtInAiClient');
      expect(entry).toBeDefined();
      expect(entry!.singleton).toBe(true);
    });

    it('memoizes one instance per container', () => {
      const container = new ServiceContainer();
      container.override('sessionStore', memoryStore());
      registerSubset(container, ['builtInAiClient']);

      expect(container.resolve('builtInAiClient')).toBe(container.resolve('builtInAiClient'));
    });
  });

  describe('shared instance flow', () => {
    it('flows the manifest singleton into the local service and the slot seam', async () => {
      const container = new ServiceContainer();
      container.override('sessionStore', memoryStore());
      const shared = {
        summarize: vi.fn().mockResolvedValue({ success: true, summary: 'manifest shared summary' }),
        getAvailability: vi.fn().mockResolvedValue('available'),
      } as unknown as BuiltInAIClient;
      container.override('builtInAiClient', shared);
      registerSubset(container, ['aiProviderBreaker', 'remoteAiService', 'aiService']);

      const remote = container.resolve<RemoteAIService>('remoteAiService');
      const seam = (remote as unknown as { createStrategy: CreateProviderStrategyFn }).createStrategy;
      const provider = seam('built-in-ai', {} as Settings) as unknown as {
        builtInAiClient: unknown;
      };
      expect(provider.builtInAiClient).toBe(shared);

      const aiService = container.resolve<AIService>('aiService');
      const local = (aiService as unknown as { config: { local: LocalAIService } }).config.local;
      const localClient = (local as unknown as { config: { localAiClient: unknown } }).config
        .localAiClient;
      expect(localClient).toBe(shared);

      const result = await aiService.generateSummary('manifest content', { mode: 'local_only' });
      expect(shared.summarize).toHaveBeenCalledWith('manifest content');
      expect(result.summary).toBe('manifest shared summary');
    });
  });
});
