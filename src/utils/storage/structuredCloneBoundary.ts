// @layer 1 — Infrastructure (depends on Layer 0 only)
/**
 * storage/structuredCloneBoundary.ts
 *
 * One definition of the storage-boundary clone policy, shared by the
 * in-memory test port and the global `chrome.storage` mock.
 *
 * WHY one copy: production `chrome.storage.local` hands out a structured clone
 * on both `get` and `set`, so a port that stores and returns the reference
 * instead turns every read-modify-write into a write the CAS verify read
 * cannot see, and tests end up checking a store the real API never exposes.
 * The port and the mock are the two doubles that stand in for that API; if
 * they each carried their own copy of the policy, one could drift and a suite
 * would pass against a store nothing else uses.
 */

/**
 * Clone a value the way the storage API does, falling back to the reference for
 * values `structuredClone` rejects (functions, DOM nodes, …). Some suites seed
 * those to exercise code paths that merely pass values through, and failing
 * them at the port boundary would report a problem they are not testing.
 */
export function cloneAtStorageBoundary<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}
