/**
 * sqliteOperationSecurity-batch-d.test.ts — PBI 2026-11-08-12 (item 7) pins.
 *
 * The cutoff scope hash binds `includeDeleted` as the boolean it is on the
 * wire (the old `as number | undefined` cast lied about the shape). The
 * digest itself is unchanged — computeScopeHash stringifies parts, and the
 * runtime values were booleans all along — so this pins the boolean
 * binding, not a new digest.
 */
import { describe, it, expect } from 'vitest';
import { deriveScopeHash } from '../sqliteOperationSecurity.js';
import { computeScopeHash } from '../../utils/scopeHash.js';

describe('cutoff scope hash boolean binding (PBI 2026-11-08-12 item 7)', () => {
  it('hashes includeDeleted as a boolean', async () => {
    const cutoffMs = 1782863999999;
    const withDeleted = await deriveScopeHash('archive_create', { cutoffMs, includeDeleted: true });
    expect(withDeleted).toBe(await computeScopeHash([cutoffMs, true]));
  });

  it('distinguishes includeDeleted true from false', async () => {
    const cutoffMs = 1782863999999;
    const withDeleted = await deriveScopeHash('archive_create', { cutoffMs, includeDeleted: true });
    const withoutDeleted = await deriveScopeHash('archive_create', { cutoffMs, includeDeleted: false });
    expect(withDeleted).toMatch(/^[0-9a-f]{64}$/);
    expect(withoutDeleted).toMatch(/^[0-9a-f]{64}$/);
    expect(withDeleted).not.toBe(withoutDeleted);
  });
});
