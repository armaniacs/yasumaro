/**
 * sqlite-taxonomy-pin.test.ts (PBI 2026-11-07-15)
 *
 * sqliteOperationSecurity.ts is the single owner of every DASHBOARD_SQLITE
 * subtype classification set. dashboardSqliteProtocol.ts only re-exports.
 * These tests fail closed on drift in either direction: a new canonical
 * subtype that no set classifies fails here, and a stale entry that is no
 * longer canonical fails here too.
 *
 * Style follows the wire-table sync asserts: no subtype names or counts are
 * hard-coded — only set differences must be empty, so the test tracks
 * ALL_DASHBOARD_SQLITE_SUBTYPES automatically.
 */
import { describe, it, expect } from 'vitest';
import {
  ALL_DASHBOARD_SQLITE_SUBTYPES,
  READ_ONLY_OPS,
  TOKEN_EXEMPT_OPS,
  tokenExempt,
  TOKEN_REQUIRED_SUBTYPES,
  MODAL_REQUIRED_SUBTYPES,
  ARCHIVE_SCOPE_BY_SUBTYPE,
} from '../sqliteOperationSecurity.js';
import { MODAL_REQUIRED_SUBTYPES as PROTOCOL_MODAL_REQUIRED_SUBTYPES } from '../dashboardSqliteProtocol.js';
import { DASHBOARD_SQLITE_SUBTYPE_SPECS } from '../validators.js';

const canonical = new Set<string>(ALL_DASHBOARD_SQLITE_SUBTYPES);

function diffMessage(label: string, extras: readonly string[]): string {
  return `${label} drift from the canonical subtype universe: ${extras.join(', ')}`;
}

describe('messaging/sqlite taxonomy single owner (PBI 2026-11-07-15)', () => {
  it('protocol re-export is the same binding (no duplicated definition)', () => {
    expect(
      PROTOCOL_MODAL_REQUIRED_SUBTYPES,
      'dashboardSqliteProtocol.ts must re-export MODAL_REQUIRED_SUBTYPES, not define its own copy',
    ).toBe(MODAL_REQUIRED_SUBTYPES);
  });

  it('every classification set only names canonical subtypes', () => {
    const sets: Readonly<Record<string, ReadonlySet<string>>> = {
      READ_ONLY_OPS,
      TOKEN_EXEMPT_OPS: new Set(TOKEN_EXEMPT_OPS),
      tokenExempt,
      TOKEN_REQUIRED_SUBTYPES,
      MODAL_REQUIRED_SUBTYPES,
    };
    for (const [name, set] of Object.entries(sets)) {
      const stale = [...set].filter((s) => !canonical.has(s));
      expect(stale, diffMessage(name, stale)).toEqual([]);
    }
    const staleScope = Object.keys(ARCHIVE_SCOPE_BY_SUBTYPE).filter(
      (s) => !canonical.has(s),
    );
    expect(staleScope, diffMessage('ARCHIVE_SCOPE_BY_SUBTYPE', staleScope)).toEqual([]);
    const staleSpecs = Object.keys(DASHBOARD_SQLITE_SUBTYPE_SPECS).filter(
      (s) => !canonical.has(s),
    );
    expect(staleSpecs, diffMessage('DASHBOARD_SQLITE_SUBTYPE_SPECS', staleSpecs)).toEqual([]);
  });

  it('TOKEN_REQUIRED_SUBTYPES is exactly the complement of the exempt set', () => {
    const exempt = new Set<string>(TOKEN_EXEMPT_OPS);
    const missing = [...canonical].filter(
      (s) => !TOKEN_REQUIRED_SUBTYPES.has(s) && !exempt.has(s),
    );
    expect(
      missing,
      `unclassified subtypes (in neither TOKEN_REQUIRED nor TOKEN_EXEMPT): ${missing.join(', ')}`,
    ).toEqual([]);
    const overlap = [...TOKEN_REQUIRED_SUBTYPES].filter((s) => exempt.has(s));
    expect(
      overlap,
      `subtypes in both TOKEN_REQUIRED_SUBTYPES and TOKEN_EXEMPT_OPS: ${overlap.join(', ')}`,
    ).toEqual([]);
  });

  it('every token-exempt op is also a read-only op (fail-safe: exemption cannot hide a mutation)', () => {
    const outside = [...TOKEN_EXEMPT_OPS].filter((s) => !READ_ONLY_OPS.has(s));
    expect(
      outside,
      `TOKEN_EXEMPT_OPS entries outside READ_ONLY_OPS (single fixed exemption point violated): ${outside.join(', ')}`,
    ).toEqual([]);
  });

  it('every modal subtype is token-required (a modal confirm must never be exempt)', () => {
    const exemptModal = [...MODAL_REQUIRED_SUBTYPES].filter((s) =>
      tokenExempt.has(s),
    );
    expect(
      exemptModal,
      `MODAL_REQUIRED_SUBTYPES entries that skip the token gate: ${exemptModal.join(', ')}`,
    ).toEqual([]);
  });
});
