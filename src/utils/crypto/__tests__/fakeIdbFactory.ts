/**
 * fakeIdbFactory.ts — shared test helper. NOT a test file.
 *
 * In-memory IDBFactory stand-in for the crypto key stores. Unit environments
 * have no IndexedDB, so the shared open/get/put body (idbKeyStorage) is
 * otherwise unreachable from tests. Requests settle on a microtask to match
 * the real API's asynchronous delivery: production assigns handlers right
 * after each call, and every event must fire after that assignment.
 *
 * The caller stubs `globalThis.indexedDB` with `factory` (keep `vi.stubGlobal`
 * in the test file itself so the isolation partition sees it).
 */

/** Failure modes the fake can inject, one per operation. */
export interface FakeIdbBehavior {
  /** indexedDB.open fails with this error (no connection is produced). */
  openError?: Error;
  /** The record read request fails. */
  getError?: Error;
  /** The record write request fails. */
  putError?: Error;
  /** db.transaction() throws this value (a string exercises non-Error wrapping). */
  transactionFailure?: unknown;
  /**
   * The database already exists without this store, so the first open never
   * creates it — the exact situation the key stores describe when two
   * openers share one database version.
   */
  omitObjectStore?: boolean;
}

interface FakeIdbRequest {
  error: Error | null;
  result: unknown;
  onupgradeneeded: (() => void) | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

/** dbName → storeName → keyId → record, exactly as the helper left it. */
export type FakeIdbRecords = Map<string, Map<string, Map<string, unknown>>>;

export interface FakeIndexedDB {
  factory: {
    open(dbName: string, version?: number): FakeIdbRequest;
  };
  /** Connections closed so far — an operation that never closes leaks a handle. */
  closeCount(): number;
  records(): FakeIdbRecords;
}

function pendingRequest(): FakeIdbRequest {
  return { error: null, result: null, onupgradeneeded: null, onsuccess: null, onerror: null };
}

export function createFakeIndexedDB(behavior: FakeIdbBehavior = {}): FakeIndexedDB {
  const databases: FakeIdbRecords = new Map();
  let closeCount = 0;

  function createDatabase(dbName: string) {
    return {
      close(): void {
        closeCount += 1;
      },
      createObjectStore(storeName: string): object {
        const stores = databases.get(dbName);
        if (!stores) {
          throw new Error('upgrade transaction is not active');
        }
        if (stores.has(storeName)) {
          throw new Error(`store already exists: ${storeName}`);
        }
        stores.set(storeName, new Map());
        return {};
      },
      transaction(storeName: string) {
        if (behavior.transactionFailure !== undefined) {
          throw behavior.transactionFailure;
        }
        const stores = databases.get(dbName);
        if (!stores || !stores.has(storeName)) {
          throw new Error(`store not found: ${storeName}`);
        }
        return {
          objectStore(storeName2: string) {
            const store = databases.get(dbName)?.get(storeName2);
            if (!store) {
              throw new Error(`store not found: ${storeName2}`);
            }
            return {
              get(key: string): FakeIdbRequest {
                const req = pendingRequest();
                queueMicrotask(() => {
                  if (behavior.getError) {
                    req.error = behavior.getError;
                    req.onerror?.();
                    return;
                  }
                  req.result = store.get(key);
                  req.onsuccess?.();
                });
                return req;
              },
              put(value: unknown, key: string): FakeIdbRequest {
                const req = pendingRequest();
                queueMicrotask(() => {
                  if (behavior.putError) {
                    req.error = behavior.putError;
                    req.onerror?.();
                    return;
                  }
                  store.set(key, value);
                  req.onsuccess?.();
                });
                return req;
              },
            };
          },
        };
      },
    };
  }

  const factory = {
    open(dbName: string): FakeIdbRequest {
      const req = pendingRequest();
      queueMicrotask(() => {
        if (behavior.openError) {
          req.error = behavior.openError;
          req.onerror?.();
          return;
        }
        const db = createDatabase(dbName);
        req.result = db;
        if (!databases.has(dbName)) {
          databases.set(dbName, new Map());
          if (!behavior.omitObjectStore) {
            req.onupgradeneeded?.();
          }
        }
        req.onsuccess?.();
      });
      return req;
    },
  };

  return {
    factory,
    closeCount: () => closeCount,
    records: () => databases,
  };
}
