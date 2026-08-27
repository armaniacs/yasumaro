/**
 * StorageBackend-comprehensive.test.ts
 * Tests for NoopBackend and StorageBackend interface contract.
 * Verifies all methods return the correct error shape.
 */

import { describe, it, expect } from 'vitest';
import { NoopBackend } from '../StorageBackend.js';
import type { BrowsingLogRecord, StorageQuery } from '../../utils/sqlite-types.js';

describe('NoopBackend', () => {
  let backend: NoopBackend;

  const NOT_INITIALIZED = 'Database not initialized';

  beforeEach(() => {
    backend = new NoopBackend();
  });

  // ── All mutation methods return { success: false, error } ────────────

  const mutationMethods = [
    { name: 'insert', args: [{} as BrowsingLogRecord] },
    { name: 'insertBatch', args: [[]] },
    { name: 'query', args: [{} as StorageQuery] },
    { name: 'update', args: [1, {}] },
    { name: 'delete', args: [1] },
    { name: 'toggleStar', args: [1] },
    { name: 'purgeOldRecords', args: [90, 1000] },
    { name: 'purgeContent', args: [] },
    { name: 'getFtsIndexSize', args: [] },
    { name: 'backupDb', args: [] },
    { name: 'restoreDb', args: [new Uint8Array()] },
    { name: 'healthCheck', args: [] },
    { name: 'getStatus', args: [] },
    { name: 'insertAuditLog', args: [{ provider: 'test', url: 'https://test.com', created_at: 1000 }] },
    { name: 'queryAuditLog', args: [{}] },
    { name: 'getCount', args: [] },
    { name: 'clearAll', args: [] },
  ];

  for (const { name, args } of mutationMethods) {
    it(`${name}() returns { success: false, error: NOT_INITIALIZED }`, async () => {
      const result = await (backend as any)[name](...args);
      expect(result).toEqual({ success: false, error: NOT_INITIALIZED });
    });
  }

  // ── All methods return promises ──────────────────────────────────────

  for (const { name, args } of mutationMethods) {
    it(`${name}() returns a Promise`, () => {
      const result = (backend as any)[name](...args);
      expect(result).toBeInstanceOf(Promise);
    });
  }

  // ── Type compatibility ───────────────────────────────────────────────

  it('satisfies the StorageBackend interface at runtime', () => {
    // Verify all required methods exist
    const requiredMethods = [
      'insert', 'insertBatch', 'query', 'update', 'delete',
      'toggleStar', 'purgeOldRecords', 'purgeContent', 'getFtsIndexSize',
      'backupDb', 'restoreDb', 'healthCheck', 'getStatus',
      'insertAuditLog', 'queryAuditLog', 'getCount', 'clearAll',
    ];
    for (const method of requiredMethods) {
      expect(typeof (backend as any)[method]).toBe('function');
    }
  });

  // ── BackendOrError type ──────────────────────────────────────────────

  it('result shape matches BackendOrError<{ success: true }>', async () => {
    const result = await backend.insert({} as BrowsingLogRecord);
    expect(result).toHaveProperty('success', false);
    expect(result).toHaveProperty('error');
    expect(typeof (result as { error: string }).error).toBe('string');
  });
});
