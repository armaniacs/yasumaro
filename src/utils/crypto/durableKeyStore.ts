/**
 * crypto/durableKeyStore.ts
 *
 * IndexedDB-backed store for non-extractable CryptoKey objects.
 *
 * WHY this exists (PBI 2026-09-14-09 follow-up): the HMAC wrapping key (KEK)
 * used to live in chrome.storage.session only (M3 mitigation for VULN-010:
 * never persist key material as bytes next to its envelope). That made every
 * wrapped HMAC key undecryptable after a browser restart — most visibly the
 * privacy-consent signature key, whose signature then failed verification and
 * reset the consent state on every browser restart (a regression of the
 * shipped fix 678f879d).
 *
 * The fix keeps the M3 posture (no key material as bytes in storage) while
 * restoring persistence: CryptoKey objects are structured-clonable, so a
 * NON-EXTRACTABLE key can be stored in IndexedDB and survives restarts
 * without its raw material ever existing as readable bytes. IndexedDB is also
 * a different store than chrome.storage.local, so the "plaintext adjacency"
 * concern of VULN-010 does not apply.
 *
 * Fail-open contract: any IndexedDB absence or error resolves to null /
 * false, and callers fall back to generating a fresh key (the pre-fix
 * behavior). secretWrappingKey talks to the same helper with the opposite
 * contract — the difference lives in these wrappers, not in the plumbing.
 */

import { createIdbKeyStorage, type IdbKeyStorage } from './idbKeyStorage.js';

const DB_NAME = 'yasumaro-crypto';
const STORE_NAME = 'hmac-wrapping-key';
const KEY_ID = 'kek-v1';

/** Minimal read/write surface used by hmacKeyStore. */
export type DurableKeyStorage = IdbKeyStorage;

// Injectable for tests: unit environments have no IndexedDB, so tests swap in
// an in-memory implementation to exercise the durable path.
let storageOverride: DurableKeyStorage | null = null;

/** Test-only: replace the durable storage backend (null restores the default). */
export function setDurableKeyStorageOverride(s: DurableKeyStorage | null): void {
  storageOverride = s;
}

function activeStorage(): DurableKeyStorage | null {
  return storageOverride ?? createIdbKeyStorage({ dbName: DB_NAME, storeName: STORE_NAME, keyId: KEY_ID, version: 1 });
}

/**
 * Load the durable wrapping key. Fail-open: absent or broken IndexedDB is
 * null, which this module's callers read as "generate a fresh key".
 */
export async function loadDurableWrappingKey(): Promise<CryptoKey | null> {
  const storage = activeStorage();
  if (!storage) return null;
  try {
    return await storage.get();
  } catch {
    return null;
  }
}

/**
 * Persist the durable wrapping key. Fail-open: false on any failure, and the
 * caller keeps the in-memory key (hmacKeyStore warns and relies on the
 * session cache).
 */
export async function saveDurableWrappingKey(key: CryptoKey): Promise<boolean> {
  const storage = activeStorage();
  if (!storage) return false;
  try {
    await storage.put(key);
    return true;
  } catch {
    return false;
  }
}
