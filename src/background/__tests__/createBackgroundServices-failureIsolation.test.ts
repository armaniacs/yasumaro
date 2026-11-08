import { describe, it, expect, vi } from 'vitest';
import { createBackgroundServices } from '../createBackgroundServices.js';
import { compositionManifest } from '../compositionManifest.js';
import { ServiceContainer } from '../serviceContainer.js';
import { flushPendingWrites } from '../pendingChromeStorageQueue.js';

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

describe('createBackgroundServices failure isolation', () => {
  describe('factory exception', () => {
    it('records the failing service instead of aborting the whole composition', () => {
      const services = createBackgroundServices(containerWithThrowingFactory('obsidian boom'));

      expect(services.serviceInitFailures).toEqual([{ key: FAILING_KEY, message: 'obsidian boom' }]);
    });

    it('still initializes the remaining services when one factory throws', () => {
      const services = createBackgroundServices(containerWithThrowingFactory('obsidian boom'));

      expect(services.sqliteClient).toEqual({ fake: 'sqliteClient' });
      expect(services.tabCache).toEqual({ fake: 'tabCache' });
      expect(services.messageRouter).toEqual({ fake: 'messageRouter' });
      expect(services.obsidian).toBeUndefined();
    });

    it('still runs onReady wiring for the healthy services', async () => {
      const container = containerWithThrowingFactory('obsidian boom');
      const fakeQueue = {
        flushPendingWrites: vi.fn().mockResolvedValue(undefined),
        enqueuePendingWrite: vi.fn(),
      };
      container.override('pendingWriteQueue', fakeQueue);

      createBackgroundServices(container);

      // The manifest's pendingWriteQueue onReady installs the facade instance;
      // it must run even though the obsidian factory threw.
      await flushPendingWrites(async () => true);

      expect(fakeQueue.flushPendingWrites).toHaveBeenCalledTimes(1);
    });
  });

  describe('healthy composition', () => {
    it('reports no failures when every factory resolves', () => {
      const services = createBackgroundServices(containerWithAllFakes());

      expect(services.serviceInitFailures).toEqual([]);
    });
  });
});
