/**
 * opfsWorkerStatus: the one predicate the diagnostics collector and the
 * diagnostics panel share (PBI 2026-10-20-17). One pin per accepted status
 * shape: the opfs-worker source, the legacy 'OPFS:' path, and the engines
 * the predicate must reject.
 */
import { describe, it, expect } from 'vitest';
import { isOpfsWorkerStatus } from '../opfsWorkerStatus.js';

describe('opfsWorkerStatus', () => {
  it('detects the opfs-worker compileOptionsSource', () => {
    expect(
      isOpfsWorkerStatus({ compileOptionsSource: 'opfs-worker', path: 'yasumaro-opfs/yasumaro.db' }),
    ).toBe(true);
  });

  it('detects the legacy OPFS: path shape', () => {
    expect(isOpfsWorkerStatus({ path: 'OPFS:/test.db' })).toBe(true);
  });

  it('rejects the idb and fallback engines', () => {
    expect(isOpfsWorkerStatus({ compileOptionsSource: 'idb', path: 'idb-batch-atomic' })).toBe(false);
    expect(isOpfsWorkerStatus({ compileOptionsSource: 'fallback', path: 'chrome.storage.local' })).toBe(false);
  });
});
