import { describe, it, expect } from 'vitest';
import {
  ValidVisitValidator,
  DashboardSqliteValidator,
  ManualRecordValidator,
  ValidationError,
  VALIDATOR_LIMITS,
  STAGING_NAME_SUBTYPES,
} from '../validators.js';
import { MAX_ARCHIVE_QUERY_LIMIT } from '../limits.js';
import { ALL_DASHBOARD_SQLITE_SUBTYPES } from '../sqliteOperationSecurity.js';

const manual = (payload: Record<string, unknown>, type = 'MANUAL_RECORD') => ({
  type,
  payload,
});

describe('ManualRecordValidator — URL scheme restriction', () => {
  const v = new ManualRecordValidator();

  it.each(['MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD'])(
    'rejects javascript: URL for %s',
    (type) => {
      expect(() =>
        v.validate(manual({ title: 't', url: 'javascript:alert(1)', content: 'c' }, type)),
      ).toThrow(ValidationError);
    },
  );

  it.each(['MANUAL_RECORD', 'PREVIEW_RECORD', 'SAVE_RECORD'])(
    'rejects data: URL for %s',
    (type) => {
      expect(() =>
        v.validate(manual({ title: 't', url: 'data:text/html,<h1>x</h1>', content: 'c' }, type)),
      ).toThrow(ValidationError);
    },
  );

  it('rejects malformed URL', () => {
    expect(() =>
      v.validate(manual({ title: 't', url: 'not-a-url', content: 'c' })),
    ).toThrow(ValidationError);
  });

  it('rejects ftp: URL', () => {
    expect(() =>
      v.validate(manual({ title: 't', url: 'ftp://example.com/f', content: 'c' })),
    ).toThrow(ValidationError);
  });

  it('accepts http and https URLs', () => {
    for (const url of ['http://example.com/', 'https://example.com/path?q=1']) {
      expect(() =>
        v.validate(manual({ title: 't', url, content: 'c' })),
      ).not.toThrow();
    }
  });
});

describe('Message payload size limits', () => {
  it('ValidVisitValidator rejects content over the limit, accepts at the limit', () => {
    const v = new ValidVisitValidator();
    const over = 'x'.repeat(VALIDATOR_LIMITS.MAX_CONTENT_LENGTH + 1);
    expect(() =>
      v.validate({ type: 'VALID_VISIT', payload: { content: over } }),
    ).toThrow(ValidationError);
    const at = 'x'.repeat(VALIDATOR_LIMITS.MAX_CONTENT_LENGTH);
    expect(() =>
      v.validate({ type: 'VALID_VISIT', payload: { content: at } }),
    ).not.toThrow();
  });

  it('ManualRecordValidator rejects oversized title and content', () => {
    const v = new ManualRecordValidator();
    const base = { title: 't', url: 'https://example.com', content: 'c' };
    expect(() =>
      v.validate(manual({ ...base, title: 't'.repeat(VALIDATOR_LIMITS.MAX_TITLE_LENGTH + 1) })),
    ).toThrow(ValidationError);
    expect(() =>
      v.validate(manual({ ...base, content: 'c'.repeat(VALIDATOR_LIMITS.MAX_CONTENT_LENGTH + 1) })),
    ).toThrow(ValidationError);
    expect(() => v.validate(manual(base))).not.toThrow();
  });

  it('DashboardSqliteValidator rejects oversized search query', () => {
    const v = new DashboardSqliteValidator();
    expect(() =>
      v.validate({ subtype: 'search', query: 'q'.repeat(VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH + 1) }),
    ).toThrow(ValidationError);
    expect(() =>
      v.validate({ subtype: 'search', query: 'q'.repeat(VALIDATOR_LIMITS.MAX_SEARCH_QUERY_LENGTH) }),
    ).not.toThrow();
  });

  it('DashboardSqliteValidator rejects import with too many rows', () => {
    const v = new DashboardSqliteValidator();
    const rows = Array.from({ length: VALIDATOR_LIMITS.MAX_IMPORT_ROWS + 1 }, (_, i) => ({ id: i }));
    expect(() => v.validate({ subtype: 'import', rows })).toThrow(ValidationError);
    expect(() => v.validate({ subtype: 'import', rows: [] })).not.toThrow();
  });

  it('DashboardSqliteValidator rejects oversized restore_db payload', () => {
    const v = new DashboardSqliteValidator();
    expect(() =>
      v.validate({ subtype: 'restore_db', data: 'd'.repeat(VALIDATOR_LIMITS.MAX_RESTORE_DB_BYTES + 1) }),
    ).toThrow(ValidationError);
  });

  it('DashboardSqliteValidator rejects append_to_obsidian with too many ids', () => {
    const v = new DashboardSqliteValidator();
    const ids = Array.from({ length: VALIDATOR_LIMITS.MAX_APPEND_IDS + 1 }, (_, i) => i);
    expect(() => v.validate({ subtype: 'append_to_obsidian', ids })).toThrow(ValidationError);
    expect(() => v.validate({ subtype: 'append_to_obsidian', ids: [1, 2] })).not.toThrow();
  });

  it('archive_query limit is bounded by the limits.ts registry, not a local literal (PBI 2026-09-17-18)', () => {
    const v = new DashboardSqliteValidator();
    const name = 'archive_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';
    expect(VALIDATOR_LIMITS.MAX_ARCHIVE_QUERY_LIMIT).toBe(MAX_ARCHIVE_QUERY_LIMIT);
    expect(() =>
      v.validate({ subtype: 'archive_query', stagingName: name, query: '', limit: MAX_ARCHIVE_QUERY_LIMIT, offset: 0 }),
    ).not.toThrow();
    expect(() =>
      v.validate({ subtype: 'archive_query', stagingName: name, query: '', limit: MAX_ARCHIVE_QUERY_LIMIT + 1, offset: 0 }),
    ).toThrow(ValidationError);
    expect(() =>
      v.validate({ subtype: 'archive_query', stagingName: name, query: '', limit: 0, offset: 0 }),
    ).toThrow(ValidationError);
  });
});

describe('Staging-name subtype coverage (PBI 2026-09-17-18)', () => {
  const v = new DashboardSqliteValidator();
  const validName = 'archive_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';

  it('pins the staging-name subtype set — a new staging subtype must extend this list consciously', () => {
    expect(STAGING_NAME_SUBTYPES).toEqual([
      'archive_export',
      'archive_delete_by_staging',
      'archive_open',
      'archive_save',
      'archive_close',
      'archive_restore_preview',
      'archive_restore',
      'archive_query',
      'archive_update',
    ]);
  });

  it('every staging subtype routes through the single decode guard', () => {
    for (const subtype of STAGING_NAME_SUBTYPES) {
      expect(() => v.validate({ subtype, stagingName: 'yasumaro.db' })).toThrow(/stagingName/);
    }
  });

  it('every known subtype either enforces required fields or is a consciously field-less op', () => {
    // The spec table is not exported; this pins its completeness observably:
    // the subtypes that validate with an EMPTY payload are exactly this list
    // (ops that take no wire fields). If a schema row ever stopped firing,
    // its subtype would silently join this set and fail the pin.
    const FIELDLESS_SUBTYPES = [
      'query',
      'migrate',
      'clear_all',
      'get_count',
      'status',
      'cleanup_legacy',
      'backfill_metadata',
      'resync_legacy',
      'backup_db',
      'purge_now',
      'content_purge_now',
      'audit_log_query',
      'archive_cleanup',
      'archive_prepare_incoming',
      'archive_status',
    ];
    const fieldless = ALL_DASHBOARD_SQLITE_SUBTYPES.filter((subtype) => {
      try {
        v.validate({ subtype });
        return true;
      } catch {
        return false;
      }
    });
    expect(fieldless).toEqual(FIELDLESS_SUBTYPES);
  });
});
