import { describe, it, expect, beforeEach } from 'vitest';
import { installTestSecretKek } from '../../crypto/__tests__/secretKekHelper.js';
import { SettingsRepository, InMemoryStorageAdapter } from '../SettingsRepository.js';
import { StorageKeys } from '../types.js';
import { __resetStorageTransactionForTest } from '../storageTransaction.js';

/**
 * settingsCacheReadYourWrite.test.ts
 *
 * Contract: a read that starts after a save completes returns the saved value
 * (read-your-write), and a save landing inside an in-flight getAll()'s async
 * window must not leave the pre-write snapshot in the repo cache for the TTL.
 *
 * The interleave is decided by gated port calls (deferred promises), not by
 * timers, so the ordering is the test's, not wall clock's.
 */

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  settled: boolean;
}

function deferred(): Deferred {
  let resolveFn!: () => void;
  const promise = new Promise<void>((r) => { resolveFn = r; });
  return {
    promise,
    settled: false,
    resolve() {
      if (this.settled) return;
      this.settled = true;
      resolveFn();
    },
  };
}

describe('SettingsRepository — cache read-your-write', () => {
  let adapter: InMemoryStorageAdapter;
  let repo: SettingsRepository;

  const KEY_A = StorageKeys.OBSIDIAN_HOST;

  const seedPreWrite = (): void => {
    adapter.seed({
      settings: { [KEY_A]: 'pre-write' } as Record<string, unknown>,
      settings_migrated: true,
    });
  };

  beforeEach(async () => {
    await installTestSecretKek();
    __resetStorageTransactionForTest();
    adapter = new InMemoryStorageAdapter();
    repo = new SettingsRepository(adapter);
  });

  it('serves the post-write value when a save completes during getAll’s async window', async () => {
    seedPreWrite();

    // Park getAll inside its blob read so it holds the pre-write snapshot
    // while the save below runs to completion (read → save → assign).
    const realGet = adapter.get.bind(adapter);
    const blobReadHeld = deferred();
    const releaseBlobRead = deferred();
    let gateOpen = true;
    adapter.get = async (keys: string | string[] | null): Promise<Record<string, unknown>> => {
      const result = await realGet(keys);
      if (gateOpen && Array.isArray(keys) && keys.includes('settings_migrated')) {
        gateOpen = false;
        blobReadHeld.resolve();
        await releaseBlobRead.promise;
      }
      return result;
    };

    const readPromise = repo.getAll();
    await blobReadHeld.promise;

    await repo.set(KEY_A, 'post-write');

    releaseBlobRead.resolve();
    await readPromise; // getAll resumes and assigns the pre-write snapshot

    // The save landed in storage…
    expect((await adapter.get(['settings']))['settings']).toMatchObject({ [KEY_A]: 'post-write' });
    // …so a read started after it must not serve the cached pre-write snapshot.
    expect(await repo.get(KEY_A)).toBe('post-write');
  });

  it('keeps the post-write drop final when getAll assigns between the pre-drop and the merge', async () => {
    seedPreWrite();

    // Park the CAS write so getAll assigns its snapshot inside the save's
    // drop window; the post-drop must land after the assignment.
    const realSet = adapter.set.bind(adapter);
    const writeHeld = deferred();
    const releaseWrite = deferred();
    adapter.set = async (items: Record<string, unknown>): Promise<void> => {
      if ('settings' in items && !releaseWrite.settled) {
        writeHeld.resolve();
        await releaseWrite.promise;
      }
      return realSet(items);
    };

    const writePromise = repo.set(KEY_A, 'post-write');
    await writeHeld.promise;

    await repo.getAll(); // assigns the pre-write snapshot while the save is parked

    releaseWrite.resolve();
    await writePromise;

    expect(await repo.get(KEY_A)).toBe('post-write');
  });

  it('pins read-your-write: the read right after a save returns the saved value', async () => {
    seedPreWrite();
    await repo.getAll(); // warm the cache with the pre-write snapshot

    await repo.set(KEY_A, 'saved-value');

    expect(await repo.get(KEY_A)).toBe('saved-value');
    expect(await repo.get(KEY_A)).toBe('saved-value');
  });
});
