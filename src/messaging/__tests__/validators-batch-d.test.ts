/**
 * validators-batch-d.test.ts — PBI 2026-11-08-12 (items 4, 5) pins.
 *
 * (4) stagingNameGuard keeps the byte-identical rejection message but no
 * longer discards the decode failure: it is available as `cause`.
 * (5) importBytesGuard maps a circular `rows` value to the layer's
 * ValidationError instead of leaking a bare TypeError from JSON.stringify.
 */
import { describe, it, expect } from 'vitest';
import {
  DashboardSqliteValidator,
  ValidationError,
} from '../validators.js';

describe('DashboardSqliteValidator staging-name detail (PBI 2026-11-08-12 item 4)', () => {
  it('keeps the pinned message and preserves the decode failure as cause', () => {
    const validator = new DashboardSqliteValidator();
    let caught: unknown;
    try {
      validator.validate({ subtype: 'archive_open', stagingName: 'yasumaro.db' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    const failure = caught as ValidationError;
    expect(failure.message).toBe('archive_open: stagingName must be a valid staging name');
    expect(failure.field).toBe('stagingName');
    expect(failure.cause).toBeInstanceOf(Error);
    expect((failure.cause as Error).message).toContain('Invalid staging name');
  });
});

describe('DashboardSqliteValidator circular import rows (PBI 2026-11-08-12 item 5)', () => {
  it('rejects circular rows as a layer ValidationError instead of throwing TypeError', () => {
    const validator = new DashboardSqliteValidator();
    const rows: unknown[] = [];
    rows.push({ url: 'https://example.com/', created_at: 1, self: rows });
    let caught: unknown;
    try {
      validator.validate({ subtype: 'import', rows });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).field).toBe('rows');
  });

  it('still accepts acyclic rows', () => {
    const validator = new DashboardSqliteValidator();
    expect(() =>
      validator.validate({
        subtype: 'import',
        rows: [{ url: 'https://example.com/', created_at: 1 }],
      }),
    ).not.toThrow();
  });
});
