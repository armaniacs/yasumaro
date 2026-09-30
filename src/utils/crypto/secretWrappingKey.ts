/**
 * crypto/secretWrappingKey.ts
 *
 * Dedicated wrapping key for ENCRYPTION_SECRET (PBI 25-25).
 *
 * The HMAC wrapping key MUST NOT be reused here: sharing one KEK couples
 * rotation and self-healing of API-secret encryption to the HMAC lifetime
 * (PBI 決定事項 2). This module owns a separate non-extractable AES-GCM key
 * in IndexedDB — a different store than chrome.storage.local, so a local-only
 * leak cannot decrypt the API key set.
 *
 * The database is separate from `durableKeyStore`'s `yasumaro-crypto` for the
 * same reason. Those two stores have independent lifetimes, and IndexedDB only
 * runs `onupgradeneeded` when the version number changes: two key stores
 * sharing one database name would each create their own object store during
 * the very first open, and the second opener — seeing version 1 already
 * present — would never create its store and could never read or write its key.
 *
 * Fail-closed contract: every function resolves to null / throws an explicit
 * error when IndexedDB or the KEK is unavailable. Callers must NOT fall back
 * to generating a fresh secret (that would orphan existing encrypted API
 * keys) and must NOT delete the stored envelope.
 *
 * The IndexedDB mechanics are shared with durableKeyStore (idbKeyStorage),
 * which has the opposite contract. The mechanics stay policy-free; the
 * fail-closed reading of a null/error is decided by the wrappers below.
 */

import { getWebCrypto, wrapStringWithKey, unwrapStringWithKey, type AeadStringEnvelope } from './primitives.js';
import { createIdbKeyStorage, type IdbKeyStorage } from './idbKeyStorage.js';

const DB_NAME = 'yasumaro-secret-crypto';
const STORE_NAME = 'secret-wrapping-key';
const KEY_ID = 'secret-kek-v1';

/** Versioned envelope stored under ENCRYPTION_SECRET (object, never a bare string). */
export interface SecretEnvelope extends AeadStringEnvelope {
  v: 1;
}

export function isSecretEnvelope(data: unknown): data is SecretEnvelope {
  if (data === null || typeof data !== 'object') {
    return false;
  }
  const env = data as Record<string, unknown>;
  return (
    env.v === 1 &&
    typeof env.wrapped === 'string' &&
    env.wrapped.length > 0 &&
    typeof env.iv === 'string' &&
    env.iv.length > 0
  );
}

/** Read/write surface for the dedicated KEK (same shape as durableKeyStore's). */
export type SecretKeyStorage = IdbKeyStorage;

function idbStorage(): SecretKeyStorage | null {
  return createIdbKeyStorage({ dbName: DB_NAME, storeName: STORE_NAME, keyId: KEY_ID, version: 1 });
}

// Injectable for tests: unit environments have no IndexedDB, so tests swap in
// an in-memory implementation to exercise the wrapped path.
let storageOverride: SecretKeyStorage | null = null;

/** Test-only: replace the secret-KEK backend (null restores the default). */
export function setSecretKeyStorageOverride(s: SecretKeyStorage | null): void {
  storageOverride = s;
}

function activeStorage(): SecretKeyStorage | null {
  return storageOverride ?? idbStorage();
}

/**
 * Load the dedicated wrapping key, or null when absent/unavailable.
 * Null is the fail-closed signal — never generate or delete on this path.
 */
export async function loadSecretWrappingKey(): Promise<CryptoKey | null> {
  const storage = activeStorage();
  if (!storage) {
    return null;
  }
  try {
    return await storage.get();
  } catch {
    return null;
  }
}

/**
 * Load the dedicated wrapping key, creating and persisting it when absent.
 * Resolves to null when IndexedDB is unavailable — the caller must fail
 * closed (explicit error), not fall back to plaintext storage.
 */
export async function getOrCreateSecretWrappingKey(): Promise<CryptoKey | null> {
  const storage = activeStorage();
  if (!storage) {
    return null;
  }
  try {
    const existing = await storage.get();
    if (existing) {
      return existing;
    }
    const created = await getWebCrypto().subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
      'encrypt',
      'decrypt',
    ]);
    await storage.put(created);
    return created;
  } catch {
    return null;
  }
}

/** Wrap a secret string with the dedicated KEK (AES-GCM mechanism, own key). */
export async function wrapSecretWithKey(secret: string, kek: CryptoKey): Promise<SecretEnvelope> {
  const { wrapped, iv } = await wrapStringWithKey(secret, kek);
  return { v: 1, wrapped, iv };
}

/** Unwrap an envelope with the dedicated KEK. Throws on tamper/version skew. */
export async function unwrapSecretWithKey(envelope: SecretEnvelope, kek: CryptoKey): Promise<string> {
  if (envelope.v !== 1) {
    throw new Error(`Unsupported secret envelope version: ${(envelope as { v: unknown }).v}`);
  }
  return unwrapStringWithKey(envelope, kek);
}
