// @layer 0 — Foundation: pure import-row contract, no chrome dependencies
/**
 * logImportContract.ts
 * Single implementation of the per-row log-import acceptance contract.
 *
 * WHY layer 0: the contract is pure data validation needed by the background
 * envelope gate (messaging/validators.ts re-exports it) and by the dashboard
 * file-import gate (dashboard/importLogsService.ts adds strict-only length
 * caps and time bounds on top). Placing it here lets both layers reference
 * one implementation, so the contract can only change in one place — the
 * former duplicate in the dashboard lenient branch drifted on nothing but
 * check order and existed only to avoid a dependency that the layer-0 rule
 * (chrome-free modules are importable from every layer) never forbade.
 */

/**
 * Per-row import contract (PBI 2026-11-08-06).
 *
 * The import spec used to check only the envelope (rows is an array, byte
 * estimate) and never looked inside a row, so a row with a missing url or a
 * mistyped field travelled all the way to insertBatch, where a single bad
 * row failed the whole batch. The dashboard file-import gate
 * (importLogsService.validateImportRowWithOptions, strict mode) layers
 * length caps and created_at bounds on top of these checks, so a
 * strict-accepted row always passes here as well.
 *
 * Returns the rejection reason, or null when the row may proceed. Null and
 * undefined field values count as absent (downstream maps them to NULL).
 */
export function validateImportRow(row: unknown): string | null {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) {
    return 'must be an object';
  }
  const r = row as Record<string, unknown>;
  if (typeof r.url !== 'string' || r.url.length === 0) {
    return 'url must be a non-empty string';
  }
  for (const field of ['title', 'summary', 'tags', 'domain', 'nav_source_url', 'search_query'] as const) {
    const v = r[field];
    if (v !== undefined && v !== null && typeof v !== 'string') {
      return `${field} must be a string`;
    }
  }
  if (typeof r.created_at !== 'number' || !Number.isFinite(r.created_at)) {
    return 'created_at must be a finite number';
  }
  const visitDuration = r.visit_duration;
  if (visitDuration !== undefined && visitDuration !== null) {
    if (typeof visitDuration !== 'number' || !Number.isFinite(visitDuration)) {
      return 'visit_duration must be a finite number';
    }
    if (visitDuration < 0) {
      return 'visit_duration must be >= 0';
    }
  }
  const scrollRatio = r.scroll_ratio;
  if (scrollRatio !== undefined && scrollRatio !== null) {
    if (typeof scrollRatio !== 'number' || !Number.isFinite(scrollRatio)) {
      return 'scroll_ratio must be a finite number';
    }
    if (scrollRatio < 0 || scrollRatio > 1) {
      return 'scroll_ratio must be between 0 and 1';
    }
  }
  for (const field of ['is_starred', 'is_deleted'] as const) {
    const v = r[field];
    if (v !== undefined && v !== null && v !== 0 && v !== 1) {
      return `${field} must be 0 or 1`;
    }
  }
  return null;
}
