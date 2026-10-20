/**
 * settingsStaleReEncryptConflict.test.ts (PBI 2026-10-18-12)
 *
 * The stale-patch hazard: three production writers captured their patch from a
 * read taken BEFORE the merge lock, so a CAS that detects the version drift
 * correctly still re-merges the same stale patch on the fresh base. The two
 * local reproductions from the PBI investigation:
 *   1. holding getAll's blob read while a credential save commits, then
 *      releasing it, used to revert the user's new key to the re-encrypted old
 *      value;
 *   2. two concurrent whitelist adds used to keep only the later one.
 *
 * Real WebCrypto with reduced PBKDF2 iterations; Map-backed storage. Every
 * interleave is expressed with deferred promises (no real-time sleep), and the
 * production CAS retry wait is driven through useTimerClock.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installTestSecretKek } from '../../crypto/__tests__/secretKekHelper.js';
import { SettingsRepository, InMemoryStorageAdapter } from '../SettingsRepository.js';
import type { StoragePort } from '../storagePort.js';
import { getOrCreateEncryptionKey } from '../encryptionSession.js';
import { deriveLegacyKeyFromStoredSecret } from '../../crypto/kdfNegotiator.js';
import { encrypt, encryptApiKey, decryptApiKey, isEncrypted } from '../../crypto/index.js';
import { __resetStorageTransactionForTest } from '../storageTransaction.js';
import { StorageKeys } from '../types.js';
import type { EncryptedData } from '../../crypto/types.js';
import { useTimerClock } from '../../../../testDir/waitPolicy.js';

// PBKDF2 at the production 600,000 iterations dominates runtime; the KDF only
// needs to behave here, not to be expensive.
vi.mock('../../crypto/cryptoParams.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../crypto/cryptoParams.js')>();
  return {
    ...actual,
    CRYPTO_PARAMS: {
      ...actual.CRYPTO_PARAMS,
      PBKDF2_ITERATIONS: 1_000,
      LEGACY_PBKDF2_ITERATIONS: 100,
    },
  };
});

/** Deferred promise helper — gates an interleave without real-time waits. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/**
 * chrome.storage.local.get snapshots at call time. The gate holds that
 * snapshot until the test opens it, so a write completing inside the read's
 * window stays invisible to the read but not to the later merge — the
 * cross-writer interleave this PBI reproduces. Only the first `gates`
 * matching reads are gated; later matching reads (the CAS verify, the retry)
 * pass through and see the live store.
 */
class GatedReadPort implements StoragePort {
  private enteredGate = deferred();
  private releaseGate = deferred();
  private gatesLeft: number;

  constructor(
    private readonly inner: InMemoryStorageAdapter,
    private readonly match: (keys: readonly string[]) => boolean,
    gates = 1,
  ) {
    this.gatesLeft = gates;
  }

  /** Resolves once a matching read is pending inside the gate. */
  waitInsideRead(): Promise<void> {
    return this.enteredGate.promise;
  }

  /** Lets the gated read return its call-time snapshot. */
  openGate(): void {
    this.releaseGate.resolve();
  }

  async get(keys: string | string[] | null): Promise<Record<string, unknown>> {
    const keyList = typeof keys === 'string' ? [keys] : (keys ?? []);
    if (this.gatesLeft > 0 && keyList.length > 0 && this.match(keyList)) {
      this.gatesLeft -= 1;
      const all = this.inner.dump();
      const snapshot: Record<string, unknown> = {};
      for (const k of keyList) {
        if (k in all) snapshot[k] = all[k];
      }
      this.enteredGate.resolve();
      await this.releaseGate.promise;
      return snapshot;
    }
    return this.inner.get(keys);
  }

  async set(items: Record<string, unknown>): Promise<void> {
    await this.inner.set(items);
  }

  async remove(keys: string | string[]): Promise<void> {
    await this.inner.remove(keys);
  }

  onChanged(callback: (changes: Record<string, unknown>) => void): void {
    this.inner.onChanged(callback);
  }
}

/** Stored settings blob, filtered to the settings key. */
async function storedBlob(adapter: InMemoryStorageAdapter): Promise<Record<string, unknown>> {
  const raw = (await adapter.get('settings'))['settings'];
  return (raw ?? {}) as Record<string, unknown>;
}

describe('settings re-encryption vs concurrent credential save (PBI 2026-10-18-12)', () => {
  let adapter: InMemoryStorageAdapter;

  beforeEach(async () => {
    await installTestSecretKek();
    __resetStorageTransactionForTest();
    adapter = new InMemoryStorageAdapter();
  });

  afterEach(() => {
    __resetStorageTransactionForTest();
    vi.unstubAllGlobals();
  });

  it('Scenario 1: plaintext key — a concurrent credential save survives the pending re-encryption patch', async () => {
    const currentKey = await getOrCreateEncryptionKey();
    const gated = new GatedReadPort(adapter, (keys) => keys.includes('settings_migrated'));
    const reader = new SettingsRepository(gated, { keyProvider: () => Promise.resolve(currentKey) });
    const writer = new SettingsRepository(adapter, { keyProvider: () => Promise.resolve(currentKey) });
    adapter.seed({
      settings: { [StorageKeys.PROVIDER_API_KEY]: 'old-dummy-key' },
      settings_migrated: true,
    });

    const readPromise = reader.getAll();
    await gated.waitInsideRead();
    // The dashboard save commits inside the SW read's window.
    await writer.setAll({ [StorageKeys.PROVIDER_API_KEY]: 'new-dummy-key' });
    gated.openGate();
    await readPromise;

    const stored = (await storedBlob(adapter))[StorageKeys.PROVIDER_API_KEY] as EncryptedData;
    expect(isEncrypted(stored)).toBe(true);
    expect(await decryptApiKey(stored, currentKey, StorageKeys.PROVIDER_API_KEY)).toBe('new-dummy-key');
    expect(await decryptApiKey(stored, currentKey, StorageKeys.PROVIDER_API_KEY)).not.toBe('old-dummy-key');
  });

  it('Scenario 1b: without a concurrent writer the re-encryption still lands (original value still current)', async () => {
    const currentKey = await getOrCreateEncryptionKey();
    const gated = new GatedReadPort(adapter, (keys) => keys.includes('settings_migrated'));
    const reader = new SettingsRepository(gated, { keyProvider: () => Promise.resolve(currentKey) });
    adapter.seed({
      settings: { [StorageKeys.PROVIDER_API_KEY]: 'old-dummy-key' },
      settings_migrated: true,
    });

    const readPromise = reader.getAll();
    await gated.waitInsideRead();
    gated.openGate();
    await readPromise;

    const stored = (await storedBlob(adapter))[StorageKeys.PROVIDER_API_KEY] as EncryptedData;
    expect(isEncrypted(stored)).toBe(true);
    expect(await decryptApiKey(stored, currentKey, StorageKeys.PROVIDER_API_KEY)).toBe('old-dummy-key');
  });

  it('Scenario 2: legacy-100k ciphertext — a concurrent credential save survives the re-migration patch', async () => {
    // deriveLegacyKeyFromStoredSecret reads chrome.storage.local directly.
    const storageData: Record<string, unknown> = {};
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn((keys: string | string[] | null) => {
            if (keys === null) return Promise.resolve({ ...storageData });
            if (typeof keys === 'string') return Promise.resolve({ [keys]: storageData[keys] });
            const out: Record<string, unknown> = {};
            for (const k of keys) out[k] = storageData[k];
            return Promise.resolve(out);
          }),
          set: vi.fn((items: Record<string, unknown>) => {
            Object.assign(storageData, items);
            return Promise.resolve();
          }),
          remove: vi.fn((keys: string | string[]) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) delete storageData[k];
            return Promise.resolve();
          }),
        },
      },
    });

    storageData[StorageKeys.ENCRYPTION_SECRET] = btoa('legacy-secret-material-for-kdf-test');
    storageData[StorageKeys.ENCRYPTION_SALT] = btoa('legacy-salt-16bytes!');
    const legacyKey = await deriveLegacyKeyFromStoredSecret();
    expect(legacyKey).not.toBeNull();
    const legacyCiphertext = await encrypt('legacy-old-value', legacyKey as CryptoKey);
    const currentKey = await getOrCreateEncryptionKey();

    const gated = new GatedReadPort(adapter, (keys) => keys.includes('settings_migrated'));
    const reader = new SettingsRepository(gated, { keyProvider: () => Promise.resolve(currentKey) });
    const writer = new SettingsRepository(adapter, { keyProvider: () => Promise.resolve(currentKey) });
    adapter.seed({
      settings: { [StorageKeys.GEMINI_API_KEY]: legacyCiphertext },
      settings_migrated: true,
    });

    const readPromise = reader.getAll();
    await gated.waitInsideRead();
    await writer.setAll({ [StorageKeys.GEMINI_API_KEY]: 'user-new-value' });
    gated.openGate();
    await readPromise;

    const stored = (await storedBlob(adapter))[StorageKeys.GEMINI_API_KEY] as EncryptedData;
    expect(isEncrypted(stored)).toBe(true);
    expect(await decryptApiKey(stored, currentKey, StorageKeys.GEMINI_API_KEY)).toBe('user-new-value');
  });

  it('Scenario 3: a pending re-encryption patch keeps a concurrent whitelist delta and only its own keys', async () => {
    const currentKey = await getOrCreateEncryptionKey();
    const gated = new GatedReadPort(adapter, (keys) => keys.includes('settings_migrated'));
    const reader = new SettingsRepository(gated, { keyProvider: () => Promise.resolve(currentKey) });
    const writer = new SettingsRepository(adapter, { keyProvider: () => Promise.resolve(currentKey) });
    adapter.seed({
      settings: {
        [StorageKeys.PROVIDER_API_KEY]: 'old-dummy-key',
        [StorageKeys.DOMAIN_WHITELIST]: ['a.example'],
      },
      settings_migrated: true,
    });

    const readPromise = reader.getAll();
    await gated.waitInsideRead();
    await writer.setAll({
      [StorageKeys.DOMAIN_WHITELIST]: ['a.example', 'b.example'],
    });
    gated.openGate();
    await readPromise;

    const blob = await storedBlob(adapter);
    expect(blob[StorageKeys.DOMAIN_WHITELIST]).toEqual(['a.example', 'b.example']);
    const storedKey = blob[StorageKeys.PROVIDER_API_KEY] as EncryptedData;
    expect(await decryptApiKey(storedKey, currentKey, StorageKeys.PROVIDER_API_KEY)).toBe('old-dummy-key');
  });

  it('Scenario 4: two concurrent whitelist adds both survive (CAS retry re-runs the updater)', async () => {
    adapter.seed({ settings: {}, settings_migrated: true });
    // Gate the FIRST lock-internal blob read of writer A.
    const gated = new GatedReadPort(adapter, (keys) => keys.includes('settings_version'));
    const repoA = new SettingsRepository(gated);
    const repoB = new SettingsRepository(adapter);

    useTimerClock();
    try {
      const addOne = repoA.updateDomainWhitelist(
        (cur) => (cur.includes('one.example') ? cur : [...cur, 'one.example']),
        { sleep: async () => {} },
      );
      await gated.waitInsideRead();
      await repoB.updateDomainWhitelist(
        (cur) => (cur.includes('two.example') ? cur : [...cur, 'two.example']),
        { sleep: async () => {} },
      );
      gated.openGate();
      // Drive the production CAS retry wait on the faked clock.
      await vi.advanceTimersByTimeAsync(1000);
      const resultOne = await addOne;

      expect(resultOne.changed).toBe(true);
      const blob = await storedBlob(adapter);
      expect(blob[StorageKeys.DOMAIN_WHITELIST]).toEqual(['two.example', 'one.example']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Scenario 5 (storage seam): setAll reports a coalesced CAS conflict through onConflictCoalesced', async () => {
    adapter.seed({
      settings: { [StorageKeys.OBSIDIAN_HOST]: 'keep' },
      settings_migrated: true,
    });
    const currentKey = await getOrCreateEncryptionKey();

    // Inject a tamper right after the first CAS write so verifyPostWrite
    // reports a conflict and the retry shell re-runs the write on the fresh base.
    const innerSet = adapter.set.bind(adapter);
    let first = true;
    const tamperPort: StoragePort = {
      get: (keys) => adapter.get(keys),
      set: async (items) => {
        await innerSet(items);
        if (first && 'settings' in items) {
          first = false;
          await innerSet({ settings_version: 999 });
        }
      },
    };

    const repo = new SettingsRepository(tamperPort, { keyProvider: () => Promise.resolve(currentKey) });
    let coalesced = false;
    useTimerClock();
    try {
      const write = repo.setAll(
        { [StorageKeys.OBSIDIAN_HOST]: 'next' },
        { onConflictCoalesced: () => { coalesced = true; } },
      );
      await vi.advanceTimersByTimeAsync(1000);
      await write;
      expect(await repo.get(StorageKeys.OBSIDIAN_HOST)).toBe('next');
    } finally {
      vi.useRealTimers();
    }
    expect(coalesced).toBe(true);
  });
});
