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
 * Fails open: any IndexedDB absence or error resolves to null, and callers
 * fall back to generating a fresh key (the pre-fix behavior).
 */

const DB_NAME = 'yasumaro-crypto';
const STORE_NAME = 'hmac-wrapping-key';
const KEY_ID = 'kek-v1';

/** Minimal read/write surface used by hmacKeyStore. */
export interface DurableKeyStorage {
  get(): Promise<CryptoKey | null>;
  put(key: CryptoKey): Promise<void>;
}

function idbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/** IndexedDB-backed implementation. Returns null when IndexedDB is absent. */
function idbStorage(): DurableKeyStorage | null {
  if (!idbAvailable()) return null;
  return {
    get(): Promise<CryptoKey | null> {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE_NAME);
        };
        req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
        req.onsuccess = () => {
          const db = req.result;
          try {
            const get = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(KEY_ID);
            get.onerror = () => { db.close(); reject(get.error ?? new Error('IDB get failed')); };
            get.onsuccess = () => {
              db.close();
              resolve((get.result as CryptoKey | undefined) ?? null);
            };
          } catch (e) {
            db.close();
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        };
      });
    },
    put(key: CryptoKey): Promise<void> {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(STORE_NAME);
        };
        req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
        req.onsuccess = () => {
          const db = req.result;
          try {
            const put = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(key, KEY_ID);
            put.onerror = () => { db.close(); reject(put.error ?? new Error('IDB put failed')); };
            put.onsuccess = () => { db.close(); resolve(); };
          } catch (e) {
            db.close();
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        };
      });
    },
  };
}

// Injectable for tests: unit environments have no IndexedDB, so tests swap in
// an in-memory implementation to exercise the durable path.
let storageOverride: DurableKeyStorage | null = null;

/** Test-only: replace the durable storage backend (null restores the default). */
export function setDurableKeyStorageOverride(s: DurableKeyStorage | null): void {
  storageOverride = s;
}

/** Load the durable wrapping key, or null when absent/unavailable. */
export async function loadDurableWrappingKey(): Promise<CryptoKey | null> {
  const storage = storageOverride ?? idbStorage();
  if (!storage) return null;
  try {
    return await storage.get();
  } catch {
    return null;
  }
}

/** Persist the durable wrapping key. Fails open (callers regenerate later). */
export async function saveDurableWrappingKey(key: CryptoKey): Promise<boolean> {
  const storage = storageOverride ?? idbStorage();
  if (!storage) return false;
  try {
    await storage.put(key);
    return true;
  } catch {
    return false;
  }
}
