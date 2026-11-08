import { describe, it, expect } from 'vitest';
import { createBackgroundServices, toDegradedServices } from '../createBackgroundServices.js';
import { compositionManifest } from '../compositionManifest.js';
import { ServiceContainer } from '../serviceContainer.js';

const FAILING_KEY = 'obsidian' as const;

/** A container where every service is faked except one throwing factory. */
function containerWithThrowingFactory(message: string): ServiceContainer {
  const container = new ServiceContainer();
  const boom = new Error(message);
  for (const entry of compositionManifest) {
    if (entry.key === FAILING_KEY) {
      container.register(entry.key, () => {
        throw boom;
      }, { singleton: true });
    } else {
      container.override(entry.key, { fake: entry.key });
    }
  }
  return container;
}

/** A container where every service is faked and nothing throws. */
function containerWithAllFakes(): ServiceContainer {
  const container = new ServiceContainer();
  for (const entry of compositionManifest) {
    container.override(entry.key, { fake: entry.key });
  }
  return container;
}

describe('toDegradedServices', () => {
  describe('failed slots', () => {
    it('resolves the failed slot to undefined instead of throwing', () => {
      const container = containerWithThrowingFactory('obsidian boom');
      expect(() => createBackgroundServices(container)).toThrow();

      const degraded = toDegradedServices(container);

      expect(degraded.obsidian).toBeUndefined();
    });

    it('resolves the cascade of the failed factory to undefined while healthy slots stay defined', () => {
      const container = containerWithThrowingFactory('obsidian boom');
      // A dependent whose factory resolves the failed key throws too, so the
      // cascade degrades with it (mirrors the real messageRouter → obsidian
      // edge without running the real router wiring, which needs chrome).
      container.register('messageRouter', (c: ServiceContainer) => ({ wrapped: c.resolve('obsidian') }), { singleton: true });
      expect(() => createBackgroundServices(container)).toThrow();

      const degraded = toDegradedServices(container);

      // The message router needs obsidian, so it degrades with it.
      expect(degraded.messageRouter).toBeUndefined();
      // Unrelated services keep their instances.
      expect(degraded.tabCache).toEqual({ fake: 'tabCache' });
      expect(degraded.sqliteClient).toEqual({ fake: 'sqliteClient' });
    });

    it('returns the same healthy singleton instances as the fail-fast composition', () => {
      const container = containerWithAllFakes();
      const services = createBackgroundServices(container);

      const degraded = toDegradedServices(container);

      expect(degraded.tabCache).toBe(services.tabCache);
      expect(degraded.sessionStore).toBe(services.sessionStore);
      expect(degraded.messageRouter).toBe(services.messageRouter);
    });
  });
});
