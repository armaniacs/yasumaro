/**
 * storagePortCloneBoundary.test.ts
 *
 * Contract (ADR 2026-09-26-withlock-object-conflict-policy, R3): both test
 * ports must have production's structured-clone boundary. Production
 * `chrome.storage.local` clones on the way in and on the way out, so the
 * stored object can never be reached by holding a reference. A port that
 * returns the reference makes a read-modify-write update the store before the
 * CAS verify read runs, and every storage test then verifies a store the real
 * port never exposes.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStoragePort, type StoragePort } from '../storagePort.js';

const factories: Array<{ name: string; create: () => StoragePort }> = [
  { name: 'InMemoryStoragePort', create: () => new InMemoryStoragePort() },
  {
    name: 'chrome.storage.local mock',
    create: () => ({
      get: (keys: string | string[] | null) => chrome.storage.local.get(keys) as Promise<Record<string, unknown>>,
      set: (items: Record<string, unknown>) => chrome.storage.local.set(items),
    }),
  },
];

async function clearAll(): Promise<void> {
  await chrome.storage.local.clear();
}

for (const { name, create } of factories) {
  describe(`${name} — structured clone boundary`, () => {
    let port: StoragePort;

    beforeEach(async () => {
      port = create();
      await clearAll();
    });

    it('returns a fresh value on every get of a stored object', async () => {
      await port.set({ settings: { theme: 'dark' } });

      const first = await port.get(['settings']);
      const second = await port.get(['settings']);

      expect(first['settings']).toEqual({ theme: 'dark' });
      expect(second['settings']).toEqual({ theme: 'dark' });
      // Same value, different identity: the stored reference is not handed out.
      expect(first['settings']).not.toBe(second['settings']);
    });

    it('does not let a mutated read result reach the store', async () => {
      await port.set({ settings: { theme: 'dark' } });

      const read = await port.get(['settings']);
      (read['settings'] as { theme: string }).theme = 'light';

      expect(((await port.get(['settings']))['settings'] as { theme: string }).theme).toBe('dark');
    });

    it('does not let a mutated write payload reach the store', async () => {
      const payload = { settings: { theme: 'dark' } };
      await port.set(payload);

      payload.settings.theme = 'light';

      expect(((await port.get(['settings']))['settings'] as { theme: string }).theme).toBe('dark');
    });

    it('clones deeply, not just the top level', async () => {
      await port.set({ settings: { nested: { theme: 'dark' } } });

      const read = await port.get(['settings']);
      (read['settings'] as { nested: { theme: string } }).nested.theme = 'light';

      const stored = (await port.get(['settings']))['settings'] as { nested: { theme: string } };
      expect(stored.nested.theme).toBe('dark');
    });
  });
}
