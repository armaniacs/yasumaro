/**
 * engineHostSeam.test.ts — PBI 2026-10-01-05.
 *
 * BDD: the host's public surface is the narrow seam. The ~10 get/set state
 * accessors are gone — the backends receive a private live view at
 * construction, backendResolver.ts is a pure decision table, and nothing
 * outside the host reaches the shared mutable state.
 */
import { describe, it, expect } from 'vitest';
import { SqliteEngineHost } from '../sqliteEngineHost.js';

describe('SqliteEngineHost — narrow seam surface (PBI 2026-10-01-05)', () => {
  it('exposes no state accessors', () => {
    const names = Object.getOwnPropertyNames(SqliteEngineHost.prototype);
    for (const accessor of [
      'idbEngine',
      'initPromise',
      'usingFallbackStorage',
      'fallbackStorage',
      'lastInitError',
      'fts5Available',
      'cachedCompileOptions',
      '_backend',
      'opfsWorker',
      'opfsRequestId',
      'opfsPending',
    ]) {
      expect(names).not.toContain(accessor);
    }
  });

  it('keeps the sanctioned seam methods on the prototype', () => {
    const names = Object.getOwnPropertyNames(SqliteEngineHost.prototype);
    for (const seam of [
      'init',
      'ensureBackend',
      'getBackend',
      'execWithCache',
      'tryOpfsProxy',
      'sendToOpfsWorker',
      'degradeFromOpfs',
      'getStatus',
      'resetForTesting',
    ]) {
      expect(names).toContain(seam);
    }
  });
});
