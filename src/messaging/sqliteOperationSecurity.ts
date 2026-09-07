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
  'clear_all',
  'get_count',
  'status',
  'cleanup_legacy',
  'backfill_metadata',
  'resync_legacy',
  'backup_db',
  'restore_db',
  'import',
  'append_to_obsidian',
  'purge_now',
  'content_purge_now',
  'audit_log_query',
  'archive_preview',
  'archive_create',
  'archive_cleanup',
  'archive_export',
  'archive_delete_by_staging',
  'archive_prepare_incoming',
  'archive_restore_preview',
  'archive_restore',
  'archive_open',
  'archive_query',
  'archive_update',
  'archive_save',
  'archive_close',
  'archive_status',
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
  'audit_log_query',
  'archive_preview',
  'archive_restore_preview',
  'archive_query',
  'archive_status',
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
  'audit_log_query',
  'archive_preview',
  'archive_restore_preview',
  'archive_query',
  'archive_status',
] as const;

export const tokenExempt: ReadonlySet<DashboardSqliteSubtype> = new Set(
  TOKEN_EXEMPT_OPS,
);

/** Derived: every subtype NOT in the exempt set requires a token. */
export const TOKEN_REQUIRED_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> =
  new Set(
    ALL_DASHBOARD_SQLITE_SUBTYPES.filter((s) => !tokenExempt.has(s)),
  );

// ============================================================================
// PBI 2026-09-06-01: confirm token scope binding for archive subtypes.
// The token previously bound only (action, id); archive operations are
// destructive through their PARAMETERS (cutoff / stagingName), so the token
// must additionally bind a hash over those parameters. The sender derives the
// hash from the payload before requesting the token, and the SW handler
// re-derives it from the actual incoming payload at verify time — a payload
// mutated in between fails the strict compare (fail-closed).
// ============================================================================

/** Which destructive parameters each archive subtype binds. Subtypes are
 * introduced by PBIs 2026-09-06-02/03/04; the mapping is defined here so the
 * verify path is in place before the first subtype lands. */
const ARCHIVE_SCOPE_BY_SUBTYPE: Record<string, 'cutoff' | 'staging'> = {
  archive_create: 'cutoff',
  archive_preview: 'cutoff',
  archive_delete_by_staging: 'staging',
  archive_restore: 'staging',
  archive_restore_preview: 'staging',
  archive_export: 'staging',
};

/**
 * Derive the scope hash for a dashboard SQLite request. Returns undefined for
 * subtypes without extra destructive parameters (existing flows unchanged).
 */
export async function deriveScopeHash(
  subtype: string,
  payload: Record<string, unknown> | undefined,
): Promise<string | undefined> {
  const kind = ARCHIVE_SCOPE_BY_SUBTYPE[subtype];
  if (!kind) return undefined;
  const { computeScopeHash } = await import('../background/confirmTokenManager.js');
  if (kind === 'cutoff') {
    return computeScopeHash([
      payload?.cutoffMs as number | undefined,
      payload?.includeDeleted as number | undefined,
    ]);
  }
  return computeScopeHash([payload?.stagingName as string | undefined]);
}
