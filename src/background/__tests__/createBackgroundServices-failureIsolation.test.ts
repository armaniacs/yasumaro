import { describe, it, expect, vi } from 'vitest';
import { createBackgroundServices, ServiceInitError } from '../createBackgroundServices.js';
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
    it('throws a ServiceInitError naming the failing service instead of returning undefined slots', () => {
      let caught: unknown;
      try {
        createBackgroundServices(containerWithThrowingFactory('obsidian boom'));
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(ServiceInitError);
      // The dashboardSqliteHandler onReady resolves 'obsidian' too, so the
      // cascade is recorded as a second failure with the same cause — every
      // wiring that could not complete is named instead of just the first.
      expect((caught as ServiceInitError).failures).toEqual([
        { key: FAILING_KEY, message: 'obsidian boom' },
        { key: 'dashboardSqliteHandler', message: 'obsidian boom' },
      ]);
      expect((caught as Error).message).toContain('obsidian');
    });

    it('still initializes the remaining services before throwing', () => {
      const container = containerWithThrowingFactory('obsidian boom');

      expect(() => createBackgroundServices(container)).toThrow(ServiceInitError);

      // Healthy services resolved despite the obsidian failure — the throw
      // reports the failure instead of handing out an undefined slot.
      expect(container.resolve('sqliteClient')).toEqual({ fake: 'sqliteClient' });
      expect(container.resolve('tabCache')).toEqual({ fake: 'tabCache' });
      expect(container.resolve('messageRouter')).toEqual({ fake: 'messageRouter' });
    });

    it('still runs onReady wiring for the healthy services before throwing', async () => {
      const container = containerWithThrowingFactory('obsidian boom');
      const fakeQueue = {
        flushPendingWrites: vi.fn().mockResolvedValue(undefined),
        enqueuePendingWrite: vi.fn(),
      };
      container.override('pendingWriteQueue', fakeQueue);

      expect(() => createBackgroundServices(container)).toThrow(ServiceInitError);

      // The manifest's pendingWriteQueue onReady installs the facade instance;
      // it must run even though the obsidian factory threw.
      await flushPendingWrites(async () => true);

      expect(fakeQueue.flushPendingWrites).toHaveBeenCalledTimes(1);
    });
  });

  describe('healthy composition', () => {
    it('returns without throwing when every factory resolves', () => {
      const services = createBackgroundServices(containerWithAllFakes());

      expect(services.sqliteClient).toEqual({ fake: 'sqliteClient' });
    });
  });
});
