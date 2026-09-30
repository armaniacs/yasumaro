/**
 * idbKeyStorage.test.ts (PBI 2026-09-30-13)
 *
 * Direct coverage for the shared IndexedDB body. Both key stores normally
 * hide it behind their override seams, so the real open/get/put path —
 * including its failure and missing-record branches — was never exercised.
 *
 * The fake settles requests on a microtask; every assertion awaits the real
 * promise the helper returns, so no test waits on elapsed time.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createIdbKeyStorage, type IdbKeyStoreDescriptor } from '../idbKeyStorage.js';
import { createFakeIndexedDB, type FakeIdbBehavior, type FakeIndexedDB } from './fakeIdbFactory.js';

const DESCRIPTOR: IdbKeyStoreDescriptor = {
  dbName: 'test-crypto',
  storeName: 'test-key',
  keyId: 'test-key-id',
  version: 1,
};

const ALGORITHM = { name: 'AES-GCM', length: 256 } as const;
const USAGES = ['encrypt', 'decrypt'] as const;

async function sampleKey(): Promise<CryptoKey> {
  return (await webcrypto.subtle.generateKey(ALGORITHM, false, [...USAGES])) as CryptoKey;
}

/** Stub the fake as the ambient IndexedDB, the way the helper discovers it. */
function installFakeIndexedDB(behavior: FakeIdbBehavior = {}): FakeIndexedDB {
  const fake = createFakeIndexedDB(behavior);
  vi.stubGlobal('indexedDB', fake.factory);
  return fake;
}

describe('idbKeyStorage', () => {
  describe('createIdbKeyStorage', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns null when IndexedDB does not exist in this environment', () => {
      vi.stubGlobal('indexedDB', undefined);

      expect(createIdbKeyStorage(DESCRIPTOR)).toBeNull();
    });

    it('creates the object store on first open and round-trips a key', async () => {
      const fake = installFakeIndexedDB();
      const storage = createIdbKeyStorage(DESCRIPTOR);
      expect(storage).not.toBeNull();
      const key = await sampleKey();

      await storage!.put(key);

      expect(await storage!.get()).toBe(key);
      expect(fake.records().get(DESCRIPTOR.dbName)?.get(DESCRIPTOR.storeName)?.get(DESCRIPTOR.keyId)).toBe(key);
      // One connection per operation, each closed — no handle outlives the call.
      expect(fake.closeCount()).toBe(2);
    });

    it('resolves null when the record is absent', async () => {
      const fake = installFakeIndexedDB();
      const storage = createIdbKeyStorage(DESCRIPTOR)!;

      expect(await storage.get()).toBeNull();
      expect(fake.closeCount()).toBe(1);
    });

    it('rejects with the open error and never opens a connection', async () => {
      const openError = new Error('open denied');
      const fake = installFakeIndexedDB({ openError });
      const storage = createIdbKeyStorage(DESCRIPTOR)!;

      await expect(storage.get()).rejects.toBe(openError);
      expect(fake.closeCount()).toBe(0);
    });

    it('rejects with the read request error and closes the connection', async () => {
      const getError = new Error('read denied');
      const fake = installFakeIndexedDB({ getError });
      const storage = createIdbKeyStorage(DESCRIPTOR)!;

      await storage.put(await sampleKey());
      await expect(storage.get()).rejects.toBe(getError);
      expect(fake.closeCount()).toBe(2);
    });

    it('rejects with the write request error and closes the connection', async () => {
      const putError = new Error('write denied');
      const fake = installFakeIndexedDB({ putError });
      const storage = createIdbKeyStorage(DESCRIPTOR)!;

      await expect(storage.put(await sampleKey())).rejects.toBe(putError);
      expect(fake.closeCount()).toBe(1);
    });

    it('rejects when the object store is missing and still closes the connection', async () => {
      const fake = installFakeIndexedDB({ omitObjectStore: true });
      const storage = createIdbKeyStorage(DESCRIPTOR)!;

      await expect(storage.get()).rejects.toThrow('store not found');
      expect(fake.closeCount()).toBe(1);
    });

    it('wraps a non-Error transaction failure in an Error', async () => {
      installFakeIndexedDB({ transactionFailure: 'boom' });
      const storage = createIdbKeyStorage(DESCRIPTOR)!;

      const result = storage.get();
      await expect(result).rejects.toBeInstanceOf(Error);
      await expect(result).rejects.toThrow('boom');
    });
  });
});
