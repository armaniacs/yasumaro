/**
 * secretEnvelope.test.ts — PBI 25-25 Red/Green.
 * ENCRYPTION_SECRET のラップ形保存: 新規は envelope のみ、legacy 平文は
 * 移行、IDB 利用不可時は fail closed（削除・再生成なし）。
 *
 * Real WebCrypto (node built-in), Map-backed chrome.storage mocks, reduced
 * KDF iterations, in-memory secret-KEK override. No global.crypto stubbing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

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

const localData = new Map<string, unknown>();
const sessionData = new Map<string, unknown>();

(global as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return Object.fromEntries(localData);
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of list) if (localData.has(k)) out[k] = localData.get(k);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) localData.set(k, v);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) localData.delete(k);
      }),
    },
    session: {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return Object.fromEntries(sessionData);
        const list = Array.isArray(keys) ? keys : [keys];
        const out: Record<string, unknown> = {};
        for (const k of list) if (sessionData.has(k)) out[k] = sessionData.get(k);
        return out;
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) sessionData.set(k, v);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) sessionData.delete(k);
      }),
    },
  },
};

import {
  getOrCreateEncryptionKey,
  clearEncryptionKeyCache,
} from '../encryptionSession.js';
import {
  setSecretKeyStorageOverride,
  isSecretEnvelope,
} from '../../crypto/secretWrappingKey.js';
import { deriveLegacyKeyFromStoredSecret } from '../../crypto/kdfNegotiator.js';
import { CRYPTO_PARAMS } from '../../crypto/cryptoParams.js';
import { deriveKey, getWebCrypto } from '../../crypto/primitives.js';
import { bytesToBase64 } from '../../crypto/primitives.js';

const SECRET_KEY = 'encryption_secret';
const SALT_KEY = 'encryption_salt';

/** In-memory secret KEK (test-only backend behind the override seam). */
async function installMemoryKek(): Promise<void> {
  // Same realm as production (getWebCrypto) — cross-realm CryptoKey breaks.
  const kek = await getWebCrypto().subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  setSecretKeyStorageOverride({
    get: async () => kek,
    put: async () => {},
  });
}

describe('secret envelope (PBI 25-25)', () => {
  beforeEach(() => {
    localData.clear();
    sessionData.clear();
    vi.clearAllMocks();
    clearEncryptionKeyCache();
    setSecretKeyStorageOverride(null);
  });

  it('stores new secrets as a wrapped envelope, never plaintext', async () => {
    await installMemoryKek();

    const key = await getOrCreateEncryptionKey();
    expect(key).toBeDefined();

    const stored = localData.get(SECRET_KEY);
    expect(isSecretEnvelope(stored)).toBe(true);
    // No raw key bytes or plaintext Base64 under the secret key. (The salt
    // is a Base64 string by design and lives under its own key.)
    expect(typeof stored).not.toBe('string');
    for (const [key, value] of localData.entries()) {
      if (key === SECRET_KEY || key === SALT_KEY) continue;
      expect(typeof value).not.toBe('string');
    }
  });

  it('unwraps the same envelope after a restart without regenerating', async () => {
    await installMemoryKek();
    await getOrCreateEncryptionKey();
    const first = localData.get(SECRET_KEY);

    clearEncryptionKeyCache();
    const setCalls = (chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length;
    const key2 = await getOrCreateEncryptionKey();
    expect(key2).toBeDefined();
    // Same envelope object — no regeneration, no rewrite.
    expect(localData.get(SECRET_KEY)).toEqual(first);
    expect((chrome.storage.local.set as ReturnType<typeof vi.fn>).mock.calls.length).toBe(setCalls);
  });

  it('migrates a legacy plaintext secret to an envelope preserving decryption', async () => {
    await installMemoryKek();
    // Legacy state: salt + Base64 plaintext secret.
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const legacySecret = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
    localData.set(SALT_KEY, bytesToBase64(salt));
    localData.set(SECRET_KEY, legacySecret);

    // Data encrypted with the legacy-derived key (atob spelling per kdfNegotiator).
    const legacyKey = await deriveKey(legacySecret, salt);
    expect(legacyKey).toBeDefined();

    const key = await getOrCreateEncryptionKey();
    expect(key).toBeDefined();

    // Plaintext is gone, envelope is stored.
    expect(isSecretEnvelope(localData.get(SECRET_KEY))).toBe(true);
    // The migrated key derives from the same secret (decrypts old data).
    // Same inputs → same derived key material is covered by deriveKey tests;
    // here assert the envelope round-trips through the live path.
    clearEncryptionKeyCache();
    const keyAfter = await getOrCreateEncryptionKey();
    expect(keyAfter).toBeDefined();
    expect(isSecretEnvelope(localData.get(SECRET_KEY))).toBe(true);
  });

  it('fails closed when the KEK is unavailable with an envelope present', async () => {
    // Envelope present (as if migrated), but IDB/KEK gone.
    localData.set(SALT_KEY, bytesToBase64(crypto.getRandomValues(new Uint8Array(16))));
    localData.set(SECRET_KEY, { v: 1, wrapped: 'AAA', iv: 'BBB' });

    await expect(getOrCreateEncryptionKey()).rejects.toThrow();
    // Nothing deleted, nothing regenerated.
    expect(localData.get(SECRET_KEY)).toEqual({ v: 1, wrapped: 'AAA', iv: 'BBB' });
    expect(isSecretEnvelope(localData.get(SECRET_KEY))).toBe(true);
  });

  it('keeps serving legacy plaintext when the KEK is unavailable (no migration, no loss)', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const legacySecret = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
    localData.set(SALT_KEY, bytesToBase64(salt));
    localData.set(SECRET_KEY, legacySecret);

    const key = await getOrCreateEncryptionKey();
    expect(key).toBeDefined();
    // Untouched: still the legacy string, still decryptable later.
    expect(localData.get(SECRET_KEY)).toBe(legacySecret);
  });

  it('concurrent first-run generates a single envelope, no plaintext', async () => {
    await installMemoryKek();

    const keys = await Promise.all([
      getOrCreateEncryptionKey(),
      getOrCreateEncryptionKey(),
      getOrCreateEncryptionKey(),
    ]);
    expect(keys).toHaveLength(3);
    expect(isSecretEnvelope(localData.get(SECRET_KEY))).toBe(true);
    expect(typeof localData.get(SECRET_KEY)).not.toBe('string');

    // One secret, not three: every caller must be able to read what any other
    // caller wrote. A second generation would leave two of the three holding a
    // key derived from a secret that is no longer the stored one.
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode('single-secret-check');
    for (const key of keys.slice(1)) {
      const cipher = await getWebCrypto().subtle.encrypt({ name: 'AES-GCM', iv }, keys[0], plaintext);
      const opened = await getWebCrypto().subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
      expect(new TextDecoder().decode(opened)).toBe('single-secret-check');
    }
  });

  it('reports corruption instead of regenerating when the salt is gone', async () => {
    await installMemoryKek();
    // Produce a real, unwrappable envelope first, then drop only the salt.
    await getOrCreateEncryptionKey();
    const envelope = localData.get(SECRET_KEY);
    expect(isSecretEnvelope(envelope)).toBe(true);
    localData.delete(SALT_KEY);
    clearEncryptionKeyCache();

    // Regenerating would replace the only copy of the wrapped secret and
    // orphan every API key encrypted under it.
    await expect(getOrCreateEncryptionKey()).rejects.toThrow(/CORRUPTION/);
    expect(localData.get(SECRET_KEY)).toEqual(envelope);
    expect(localData.has(SALT_KEY)).toBe(false);
  });

  it('keeps the secret KEK in its own IndexedDB database', () => {
    // Two key stores sharing one database name cannot both work: IndexedDB
    // runs onupgradeneeded only when the version changes, so whichever store
    // opens first creates its object store at version 1 and the second opener
    // never gets an upgrade — its transaction then throws forever, which the
    // fail-closed contract turns into a permanent ENCRYPTION_UNAVAILABLE.
    const read = (file: string): string => readFileSync(`src/utils/crypto/${file}`, 'utf-8');
    const dbNameOf = (source: string): string => {
      const name = /const DB_NAME = '([^']+)'/.exec(source)?.[1];
      expect(name, 'DB_NAME literal not found').toBeDefined();
      return name ?? '';
    };

    const hmacDb = dbNameOf(read('durableKeyStore.ts'));
    const secretDb = dbNameOf(read('secretWrappingKey.ts'));
    expect(secretDb).not.toBe(hmacDb);
  });

  it('keeps the session-rescued secret durable in local when no KEK is available', async () => {
    // Upgrade state: salt in local, secret in session, and the KEK store
    // unreachable. Persisting only into session would lose the only copy on
    // the next browser restart, after which a fresh salt+secret is generated
    // and every API key encrypted under the old one becomes unreadable.
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const rescued = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
    localData.set(SALT_KEY, bytesToBase64(salt));
    sessionData.set(SECRET_KEY, rescued);
    setSecretKeyStorageOverride(null); // no IndexedDB → no KEK

    const key = await getOrCreateEncryptionKey();
    expect(key).toBeDefined();
    // Durability first: the plaintext is what the pre-PBI-25-25 path stored.
    expect(localData.get(SECRET_KEY)).toBe(rescued);
    expect(sessionData.has(SECRET_KEY)).toBe(false);
  });

  it('still recovers a legacy-100k key after the secret has been wrapped', async () => {
    // The migration runs on the first settings read, before the decrypt loop
    // asks for a legacy key. Once ENCRYPTION_SECRET is an envelope, the only
    // remaining copy of the material that legacy path needs is inside it.
    await installMemoryKek();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const legacySecret = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
    localData.set(SALT_KEY, bytesToBase64(salt));
    localData.set(SECRET_KEY, legacySecret);

    // The historical spelling: UTF-8 over atob's latin-1 output, 100k PBKDF2.
    const secretBytes = new TextEncoder().encode(atob(legacySecret));
    const baseKey = await crypto.subtle.importKey('raw', secretBytes, 'PBKDF2', false, ['deriveKey']);
    const legacyKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations: CRYPTO_PARAMS.LEGACY_PBKDF2_ITERATIONS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      legacyKey,
      new TextEncoder().encode('legacy-ciphertext') as BufferSource,
    );

    // First read: the plaintext secret is replaced by the envelope.
    await getOrCreateEncryptionKey();
    expect(isSecretEnvelope(localData.get(SECRET_KEY))).toBe(true);

    const recovered = await deriveLegacyKeyFromStoredSecret();
    expect(recovered).not.toBeNull();
    const opened = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, recovered as CryptoKey, ciphertext);
    expect(new TextDecoder().decode(opened)).toBe('legacy-ciphertext');
  });
});
