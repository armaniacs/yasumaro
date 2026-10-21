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
 * Contract: loadDurableWrappingKey reports a missing record (absent) and a
 * failed store (failure) as different outcomes (DurableWrappingKeyOutcome) —
 * a fresh install and a lost persistence store are different facts, and
 * collapsing them is the caller's decision (PBI 2026-10-21-10).
 * saveDurableWrappingKey stays fail-open: false on any failure, and the
 * caller keeps the in-memory key. secretWrappingKey talks to the same helper
 * with the opposite contract — the difference lives in these wrappers, not
 * in the plumbing.
 */

import { toError } from '../errorUtils.js';
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
 * Outcome of loading the durable wrapping key. `absent` covers both "no
 * durable storage in this environment" and "the record is not there yet" — a
 * fresh install, safe to regenerate. `failure` means the durable store
 * itself rejected (open or read): persistence may be lost, and reading that
 * as absent would orphan every wrapped key while looking like a fresh
 * install (PBI 2026-10-21-10). Collapsing the two is the caller's decision.
 */
export type DurableWrappingKeyOutcome =
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'failure'; readonly error: Error }
  | { readonly outcome: 'loaded'; readonly key: CryptoKey };

/**
 * Load the durable wrapping key and report what happened: absent (no durable
 * storage here, or no record yet), failure (the store rejected), or the
 * loaded key. No catch-and-round: a failed read is a failure, not an absent
 * record.
 */
export async function loadDurableWrappingKey(): Promise<DurableWrappingKeyOutcome> {
  const storage = activeStorage();
  if (!storage) return { outcome: 'absent' };
  try {
    const key = await storage.get();
    return key ? { outcome: 'loaded', key } : { outcome: 'absent' };
  } catch (e) {
    return { outcome: 'failure', error: toError(e) };
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
