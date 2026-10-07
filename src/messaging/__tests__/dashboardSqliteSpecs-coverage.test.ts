/**
 * dashboardSqliteSpecs-coverage.test.ts (PBI 2026-10-07-12)
 *
 * DASHBOARD_SQLITE_SUBTYPE_SPECS is a string-keyed Record, so a forgotten row
 * for a canonical subtype silently skips payload validation entirely
 * (DashboardSqliteValidator.validate treats an undefined spec as "nothing to
 * enforce"). These tests fail closed in both directions: a new canonical
 * subtype without a spec row fails here, and a stale or typo'd table key fails
 * here too. Intentionally unspecified subtypes are pinned in an explicit
 * allowlist — a later spec row means removing the pin, so the two sides cannot
 * drift silently.
 */
import { describe, it, expect } from 'vitest';
import { DASHBOARD_SQLITE_SUBTYPE_SPECS } from '../validators.js';
import { ALL_DASHBOARD_SQLITE_SUBTYPES } from '../sqliteOperationSecurity.js';

/**
 * Subtypes that have no payload schema row on purpose. Every entry carries its
 * reason; a new canonical subtype must add a spec row instead of landing here.
 */
const INTENTIONALLY_UNSPECIFIED: Readonly<Record<string, string>> = {
  query: 'accepts arbitrary extra fields',
  migrate: 'no required payload fields (confirmToken is verified by the token gate, not wire validation)',
  clear_all: 'no required payload fields (confirmToken is verified by the token gate)',
  get_count: 'no payload',
  status: 'no payload',
  cleanup_legacy: 'optional-only payload (confirmToken)',
  backfill_metadata: 'optional-only payload (confirmToken)',
  resync_legacy: 'optional-only payload (maxRecords, confirmToken)',
  backup_db: 'optional-only payload (confirmToken)',
  purge_now: 'no payload',
  content_purge_now: 'no payload',
  audit_log_query: 'optional-only payload (limit, offset)',
  archive_cleanup: 'optional-only payload (confirmToken)',
  archive_prepare_incoming: 'no payload',
  archive_status: 'no payload',
};

describe('messaging/DASHBOARD_SQLITE_SUBTYPE_SPECS: all-subtype coverage (fail closed)', () => {
  it('every canonical subtype has a spec row or is pinned in the intentionally-unspecified allowlist', () => {
    for (const subtype of ALL_DASHBOARD_SQLITE_SUBTYPES) {
      if (subtype in INTENTIONALLY_UNSPECIFIED) continue;
      expect(
        DASHBOARD_SQLITE_SUBTYPE_SPECS[subtype],
        `subtype ${subtype} has no payload spec row — add one to DASHBOARD_SQLITE_SUBTYPE_SPECS (or pin it in INTENTIONALLY_UNSPECIFIED with a reason)`,
      ).toBeDefined();
    }
  });

  it('every spec row key is a real canonical subtype (typo guard for the string-keyed Record)', () => {
    for (const key of Object.keys(DASHBOARD_SQLITE_SUBTYPE_SPECS)) {
      expect(
        (ALL_DASHBOARD_SQLITE_SUBTYPES as readonly string[]).includes(key),
        `spec key ${key} is not a canonical subtype — fix or remove the stale row`,
      ).toBe(true);
    }
  });

  it('every allowlist entry is a real subtype and still has no spec row (pin removal is deliberate)', () => {
    for (const [subtype] of Object.entries(INTENTIONALLY_UNSPECIFIED)) {
      expect(
        (ALL_DASHBOARD_SQLITE_SUBTYPES as readonly string[]).includes(subtype),
        `allowlist entry ${subtype} is not a canonical subtype — fix or remove the stale pin`,
      ).toBe(true);
      expect(
        DASHBOARD_SQLITE_SUBTYPE_SPECS[subtype],
        `allowlist entry ${subtype} now has a spec row — remove it from INTENTIONALLY_UNSPECIFIED`,
      ).toBeUndefined();
    }
  });

  it('every spec row actually validates something (an empty {} row would silently skip enforcement)', () => {
    const table: Readonly<Record<string, { guardFirst?: unknown; guardLast?: unknown; fields?: readonly unknown[] }>> =
      DASHBOARD_SQLITE_SUBTYPE_SPECS;
    for (const [key, spec] of Object.entries(table)) {
      const enforces =
        spec.guardFirst !== undefined ||
        spec.guardLast !== undefined ||
        (spec.fields?.length ?? 0) > 0;
      expect(enforces, `spec row ${key} has no guard and no field rows — it enforces nothing`).toBe(true);
    }
  });
});
