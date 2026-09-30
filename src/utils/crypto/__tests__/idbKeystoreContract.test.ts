/**
 * idbKeystoreContract.test.ts (PBI 2026-09-30-13)
 *
 * durableKeyStore と secretWrappingKey は同一の IndexedDB 実装
 * (idbKeyStorage) を共有するが、null / false の読み方が正反対だ。
 * ヘルパー側にポリシーを埋め込まないことで各ラッパーに残った契約を pin する:
 * 壊れた IndexedDB で片方が「再生成してよい」、もう片方が「中断せよ」であること。
 *
 * Real WebCrypto, fake IndexedDB, no override seam — this is the path unit
 * tests previously never reached because every suite swapped in a backend.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { loadDurableWrappingKey, saveDurableWrappingKey } from '../durableKeyStore.js';
import { getOrCreateSecretWrappingKey, loadSecretWrappingKey } from '../secretWrappingKey.js';
import { createFakeIndexedDB, type FakeIdbBehavior, type FakeIndexedDB } from './fakeIdbFactory.js';

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

describe('IndexedDB keystore contracts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('loadDurableWrappingKey (fail-open)', () => {
    it('treats a failed open as "no key yet" so the caller may regenerate', async () => {
      installFakeIndexedDB({ openError: new Error('open denied') });

      expect(await loadDurableWrappingKey()).toBeNull();
    });

    it('treats a failed read as "no key yet" instead of propagating', async () => {
      installFakeIndexedDB({ getError: new Error('read denied') });

      expect(await loadDurableWrappingKey()).toBeNull();
    });

    it('round-trips a persisted key through the real IndexedDB path', async () => {
      const fake = installFakeIndexedDB();
      const key = await sampleKey();

      expect(await saveDurableWrappingKey(key)).toBe(true);
      expect(await loadDurableWrappingKey()).toBe(key);
      expect(fake.records().get('yasumaro-crypto')?.get('hmac-wrapping-key')?.get('kek-v1')).toBe(key);
    });
  });

  describe('saveDurableWrappingKey (fail-open)', () => {
    it('reports a failed write as false so the caller keeps the in-memory key', async () => {
      installFakeIndexedDB({ putError: new Error('write denied') });

      expect(await saveDurableWrappingKey(await sampleKey())).toBe(false);
    });
  });

  describe('loadSecretWrappingKey (fail-closed)', () => {
    it('returns null on a failed open so the caller aborts instead of unwrapping', async () => {
      installFakeIndexedDB({ openError: new Error('open denied') });

      expect(await loadSecretWrappingKey()).toBeNull();
    });

    it('returns null on a failed read so the caller aborts instead of unwrapping', async () => {
      installFakeIndexedDB({ getError: new Error('read denied') });

      expect(await loadSecretWrappingKey()).toBeNull();
    });
  });

  describe('getOrCreateSecretWrappingKey (fail-closed)', () => {
    it('does not generate a KEK when IndexedDB cannot be opened', async () => {
      const fake = installFakeIndexedDB({ openError: new Error('open denied') });

      expect(await getOrCreateSecretWrappingKey()).toBeNull();
      // Nothing was created either: a generated-but-unpersisted KEK would
      // orphan every encrypted API key on the next restart.
      expect(fake.records().size).toBe(0);
    });

    it('generates and persists a KEK only once the store is readable', async () => {
      const fake = installFakeIndexedDB();

      const kek = await getOrCreateSecretWrappingKey();

      expect(kek).not.toBeNull();
      expect(await loadSecretWrappingKey()).toBe(kek);
      expect(fake.records().get('yasumaro-secret-crypto')?.get('secret-wrapping-key')?.get('secret-kek-v1')).toBe(kek);
      // Second call returns the persisted key rather than a new one.
      expect(await getOrCreateSecretWrappingKey()).toBe(kek);
    });
  });
});
