import { describe, it, expect } from 'vitest';
import {
  ValidVisitValidator,
  DashboardSqliteValidator,
  ManualRecordValidator,
  ValidationError,
  VALIDATOR_LIMITS,
} from '../validators.js';

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
});
