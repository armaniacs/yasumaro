import { describe, it, expect } from 'vitest';
import {
  MAX_APPEND_IDS,
  MAX_IMPORT_ROWS,
  MAX_IMPORT_BYTES,
  MAX_RESTORE_DB_BYTES,
  MAX_ARCHIVE_EXPORT_CHUNK_BYTES,
  MAX_CONTENT_LENGTH,
  MAX_TITLE_LENGTH,
  MAX_SEARCH_QUERY_LENGTH,
  MAX_RESTORE_BASE64_BYTES,
  AUDIT_CAP_OPFS,
  AUDIT_CAP_IDB,
} from '../limits.js';
import { VALIDATOR_LIMITS } from '../validators.js';
import {
  MAX_APPEND_IDS as DEPS_MAX_APPEND_IDS,
  MAX_IMPORT_ROWS as DEPS_MAX_IMPORT_ROWS,
  MAX_RESTORE_BASE64_BYTES as DEPS_MAX_RESTORE_BASE64_BYTES,
} from '../../background/handlers/dashboardSqlite/deps.js';

/**
 * Drift guard for the limits registry: every authority over the same
 * concept must read the same binding, so reintroducing a second literal
 * fails here instead of silently reopening a fail-open gap.
 */
describe('messaging/limits — single source of truth', () => {
  it('pins the effective bounds (strictest value previously enforced)', () => {
    expect(MAX_IMPORT_ROWS).toBe(1_000);
    expect(MAX_APPEND_IDS).toBe(100);
    expect(MAX_RESTORE_BASE64_BYTES).toBe(150 * 1024 * 1024);
  });

  it('validator limits reference the registry (no second literal)', () => {
    expect(VALIDATOR_LIMITS.MAX_CONTENT_LENGTH).toBe(MAX_CONTENT_LENGTH);
    expect(VALIDATOR_LIMITS.MAX_TITLE_LENGTH).toBe(MAX_TITLE_LENGTH);
    expect(VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH).toBe(MAX_SEARCH_QUERY_LENGTH);
    expect(VALIDATOR_LIMITS.MAX_IMPORT_ROWS).toBe(MAX_IMPORT_ROWS);
    expect(VALIDATOR_LIMITS.MAX_IMPORT_BYTES).toBe(MAX_IMPORT_BYTES);
    expect(VALIDATOR_LIMITS.MAX_RESTORE_DB_BYTES).toBe(MAX_RESTORE_DB_BYTES);
    expect(VALIDATOR_LIMITS.MAX_ARCHIVE_EXPORT_CHUNK_BYTES).toBe(MAX_ARCHIVE_EXPORT_CHUNK_BYTES);
    expect(VALIDATOR_LIMITS.MAX_APPEND_IDS).toBe(MAX_APPEND_IDS);
  });

  it('handler constants re-export the registry binding', () => {
    expect(DEPS_MAX_APPEND_IDS).toBe(MAX_APPEND_IDS);
    expect(DEPS_MAX_IMPORT_ROWS).toBe(MAX_IMPORT_ROWS);
    expect(DEPS_MAX_RESTORE_BASE64_BYTES).toBe(MAX_RESTORE_BASE64_BYTES);
  });

  it('keeps the intentional audit divergence named and distinct', () => {
    expect(AUDIT_CAP_OPFS).toBe(1_000);
    expect(AUDIT_CAP_IDB).toBe(100_000);
    expect(AUDIT_CAP_OPFS).not.toBe(AUDIT_CAP_IDB);
  });
});
