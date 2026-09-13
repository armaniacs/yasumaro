import { describe, it, expect } from 'vitest';
import {
  ALL_DASHBOARD_SQLITE_SUBTYPES,
  TOKEN_EXEMPT_OPS,
  ARCHIVE_SCOPE_BY_SUBTYPE,
  deriveScopeHash,
} from '../sqliteOperationSecurity.js';

/**
 * Drift guard for archive token scope binding (PBI 2026-09-11-01).
 *
 * Every archive subtype that carries a destructive parameter must be
 * scope-bound, otherwise a token issued for one scope (e.g. stagingA) can be
 * replayed against another (stagingB). Subtypes without destructive parameters
 * are explicitly listed with the reason, so a NEW archive subtype fails this
 * test until it is either bound or justified here.
 */

/** Archive subtypes intentionally unbound — no destructive parameters. */
const UNBOUND_ARCHIVE_SUBTYPES: ReadonlySet<string> = new Set([
  // Server generates the staging name; the request carries nothing destructive.
  'archive_prepare_incoming',
  // Sweeps orphan staging files; no target parameters.
  'archive_cleanup',
]);

/** Archive subtypes that are token-exempt (read-only) need no binding. */
const tokenExempt = new Set<string>(TOKEN_EXEMPT_OPS);

describe('archive token scope binding drift guard (PBI 2026-09-11-01)', () => {
  it('binds every token-required archive subtype that is not explicitly unbound', () => {
    const archiveSubtypes = ALL_DASHBOARD_SQLITE_SUBTYPES.filter((s) =>
      s.startsWith('archive_'),
    );
    expect(archiveSubtypes.length).toBeGreaterThanOrEqual(10);
    for (const subtype of archiveSubtypes) {
      if (tokenExempt.has(subtype) || UNBOUND_ARCHIVE_SUBTYPES.has(subtype)) {
        continue;
      }
      expect(
        ARCHIVE_SCOPE_BY_SUBTYPE[subtype],
        `${subtype} is token-required and not explicitly unbound — add a scope binding or justify it in UNBOUND_ARCHIVE_SUBTYPES`,
      ).toBeDefined();
    }
  });

  it('every binding is a known scope kind', () => {
    for (const kind of Object.values(ARCHIVE_SCOPE_BY_SUBTYPE)) {
      expect(['cutoff', 'staging']).toContain(kind);
    }
  });

  it('deriveScopeHash returns a hash for the session subtypes (open/update/save/close)', async () => {
    const stagingName = 'archive_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
    for (const subtype of ['archive_open', 'archive_update', 'archive_save', 'archive_close']) {
      const hash = await deriveScopeHash(subtype, { stagingName });
      expect(hash, `${subtype} must derive a scope hash`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('derives distinct hashes per stagingName (stagingA token cannot verify for stagingB)', async () => {
    const hashA = await deriveScopeHash('archive_open', { stagingName: 'staging-a.db' });
    const hashB = await deriveScopeHash('archive_open', { stagingName: 'staging-b.db' });
    expect(hashA).not.toBe(hashB);
  });

  it('leaves prepare_incoming / cleanup unbound (no destructive parameters)', async () => {
    expect(await deriveScopeHash('archive_prepare_incoming', {})).toBeUndefined();
    expect(await deriveScopeHash('archive_cleanup', {})).toBeUndefined();
  });
});
