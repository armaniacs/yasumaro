/**
 * compositionManifest-breaker.test.ts — PBI 27-03 acceptance.
 * Resolving through the manifest entries (not a direct import) proves the
 * aiProviderBreaker wiring: the breaker the container hands to
 * RemoteAIService is the same instance the policy tests drive.
 */
import { describe, it, expect } from 'vitest';
import { compositionManifest } from '../compositionManifest.js';
import { ServiceContainer, type ServiceKey } from '../serviceContainer.js';
import { ProviderBreaker } from '../ai/providerBreaker.js';
import { RemoteAIService } from '../ai/RemoteAIService.js';
import type { SessionStorePort } from '../sessionStore.js';

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

describe('compositionManifest breaker wiring', () => {
  it('registers aiProviderBreaker and injects it into remoteAiService', () => {
    const keys = compositionManifest.map((entry) => entry.key);
    expect(keys).toContain('aiProviderBreaker');
    expect(keys).toContain('remoteAiService');

    const container = new ServiceContainer();
    container.override('sessionStore', memoryStore());
    for (const entry of compositionManifest) {
      if (entry.key === 'aiProviderBreaker' || entry.key === 'remoteAiService') {
        container.register(entry.key as ServiceKey, () => entry.factory(container), {
          singleton: entry.singleton,
        });
      }
    }

    const breaker = container.resolve<ProviderBreaker>('aiProviderBreaker');
    expect(breaker).toBeInstanceOf(ProviderBreaker);
    const remote = container.resolve<RemoteAIService>('remoteAiService');
    expect(remote).toBeInstanceOf(RemoteAIService);

    // Singleton: RemoteAIService holds the same breaker instance.
    expect(container.resolve<ProviderBreaker>('aiProviderBreaker')).toBe(breaker);
  });
});
