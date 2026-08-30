/**
 * Single source of truth for which DASHBOARD_SQLITE operations require a
 * confirmToken.
 *
 * Design (fail-safe by construction — see
 * dev-docs/plans/2026-08-09-pbi23-phase3-senior-consultation.md §10.5–10.7):
 *
 * We encode the *exempt* (read-only) set, not a per-op `requiresToken: boolean`.
 * A new or forgotten operation is token-required by default, so a missing entry
 * fails safe (over-reject) rather than silently disabling the guard. The only
 * way to make an operation token-exempt is to add it to the explicit,
 * test-guarded `TOKEN_EXEMPT_OPS` allowlist — a deliberate, reviewable act.
 *
 * Both the receiver gate (`handlers`) and the sender (`dashboardSqliteService`)
 * derive their decision from this one table, so the two can never drift.
 */

/** Canonical list of every DASHBOARD_SQLITE subtype. Single source of truth. */
export const ALL_DASHBOARD_SQLITE_SUBTYPES = [
  'create_confirm_token',
  'query',
  'search',
  'toggle_star',
  'delete',
  'update',
  'migrate',
  'opfs_spike',
  'clear_all',
  'get_count',
  'status',
  'cleanup_legacy',
  'backfill_metadata',
  'backup_db',
  'restore_db',
  'import',
  'append_to_obsidian',
  'purge_now',
  'content_purge_now',
  'audit_log_query',
] as const;

export type DashboardSqliteSubtype =
  (typeof ALL_DASHBOARD_SQLITE_SUBTYPES)[number];

/**
 * Read-only operations that must never mutate or exfiltrate user data.
 * Canonical safe set used by the allowlist-integrity test.
 */
export const READ_ONLY_OPS: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'create_confirm_token',
  'query',
  'search',
  'get_count',
  'status',
  'opfs_spike',
  'audit_log_query',
]);

/**
 * Subtypes exempt from the confirmToken gate. Kept as its own literal list
 * (not aliased to READ_ONLY_OPS) so the integrity test can assert every exempt
 * op is also a read-only op — catching a destructive op mistakenly added here.
 */
export const TOKEN_EXEMPT_OPS = [
  'create_confirm_token',
  'query',
  'search',
  'get_count',
  'status',
  'opfs_spike',
  'audit_log_query',
] as const;

export const tokenExempt: ReadonlySet<DashboardSqliteSubtype> = new Set(
  TOKEN_EXEMPT_OPS,
);

/** Derived: every subtype NOT in the exempt set requires a token. */
export const TOKEN_REQUIRED_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> =
  new Set(
    ALL_DASHBOARD_SQLITE_SUBTYPES.filter((s) => !tokenExempt.has(s)),
  );
