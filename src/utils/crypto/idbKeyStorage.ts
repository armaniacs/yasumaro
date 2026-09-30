/**
 * crypto/idbKeyStorage.ts
 *
 * Shared IndexedDB open/get/put for the keyed CryptoKey records held by
 * durableKeyStore and secretWrappingKey. Both stores carried their own
 * near-verbatim copy of this boilerplate, so a fix could land in one copy and
 * not the other while the two stayed byte-identical everywhere else.
 *
 * The helper reports raw outcomes only: `get` resolves null when the record is
 * absent and rejects on open/transaction failure; `put` rejects on failure.
 * Which of those outcomes a caller may act on belongs to the key store that
 * wraps it — baking fail-open or fail-closed into this plumbing would make the
 * same `null` mean "regenerate" in one store and "abort" in the other, with
 * nothing at the call site telling them apart.
 */

/** Read/write surface for a single keyed CryptoKey record. */
export interface IdbKeyStorage {
  get(): Promise<CryptoKey | null>;
  put(key: CryptoKey): Promise<void>;
}

/** Identifies the one record an {@link IdbKeyStorage} reads and writes. */
export interface IdbKeyStoreDescriptor {
  dbName: string;
  storeName: string;
  keyId: string;
  /**
   * Kept at each store's existing value: IndexedDB runs onupgradeneeded only
   * on a version change, and this module's upgrade handler creates the store,
   * which throws (aborting the open) when the store already exists.
   */
  version: number;
}

function openDatabase({ dbName, storeName, version }: IdbKeyStoreDescriptor): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(storeName);
    };
    req.onerror = () => reject(req.error ?? new Error('IDB open failed'));
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * Run one request against the descriptor's object store and close the
 * connection on every exit path — a leaked connection stays locked until the
 * browser drops it.
 */
async function runOnStore<T>(
  descriptor: IdbKeyStoreDescriptor,
  mode: IDBTransactionMode,
  failureLabel: string,
  start: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase(descriptor);
  let request: IDBRequest<T>;
  try {
    request = start(db.transaction(descriptor.storeName, mode).objectStore(descriptor.storeName));
  } catch (e) {
    db.close();
    throw e instanceof Error ? e : new Error(String(e));
  }
  try {
    return await new Promise<T>((resolve, reject) => {
      request.onerror = () => reject(request.error ?? new Error(`IDB ${failureLabel} failed`));
      request.onsuccess = () => resolve(request.result);
    });
  } finally {
    db.close();
  }
}

/**
 * Build the storage for one key record, or null when IndexedDB does not exist
 * in this environment. The returned object has no policy of its own: it only
 * reports what the database said.
 */
export function createIdbKeyStorage(descriptor: IdbKeyStoreDescriptor): IdbKeyStorage | null {
  if (typeof indexedDB === 'undefined') {
    return null;
  }
  return {
    get(): Promise<CryptoKey | null> {
      return runOnStore<CryptoKey | undefined>(descriptor, 'readonly', 'get', (store) =>
        store.get(descriptor.keyId),
      ).then((record) => record ?? null);
    },
    put(key: CryptoKey): Promise<void> {
      return runOnStore(descriptor, 'readwrite', 'put', (store) => store.put(key, descriptor.keyId)).then(
        () => undefined,
      );
    },
  };
}
