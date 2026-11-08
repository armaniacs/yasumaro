/**
 * validators-rowValidation-r2.test.ts (PBI 2026-11-08-06)
 *
 * The import spec used to look only at the envelope (rows is an array, byte
 * estimate) and the update spec only at the changes shape, so mistyped rows
 * and values passed the envelope and failed later at the SQL layer. These
 * tests pin the row/value contract at the envelope gate.
 */
import { describe, it, expect } from 'vitest';
import {
  DashboardSqliteValidator,
  ValidationError,
  validateImportRow,
  validateUpdateChanges,
} from '../validators.js';

const v = new DashboardSqliteValidator();

function validRow(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return { url: 'https://example.com/a', created_at: 1700000000000, ...patch };
}

describe('validators/validateImportRow', () => {
  describe('validateImportRow', () => {
    it('accepts a minimal valid row', () => {
      expect(validateImportRow(validRow())).toBeNull();
    });

    it('rejects a non-object row', () => {
      expect(validateImportRow(null)).not.toBeNull();
      expect(validateImportRow('https://example.com')).not.toBeNull();
      expect(validateImportRow([validRow()])).not.toBeNull();
    });

    it('rejects a row without a url', () => {
      const row = validRow();
      delete row.url;
      expect(validateImportRow(row)).toContain('url');
    });

    it('rejects a mistyped text field', () => {
      expect(validateImportRow(validRow({ title: 123 }))).toContain('title');
    });

    it('rejects a non-finite created_at', () => {
      expect(validateImportRow(validRow({ created_at: 'yesterday' }))).toContain('created_at');
    });

    it('rejects out-of-range engagement metrics', () => {
      expect(validateImportRow(validRow({ visit_duration: -1 }))).toContain('visit_duration');
      expect(validateImportRow(validRow({ scroll_ratio: 5 }))).toContain('scroll_ratio');
    });

    it('rejects a non-flag is_starred', () => {
      expect(validateImportRow(validRow({ is_starred: 2 }))).toContain('is_starred');
    });
  });
});

describe('DashboardSqliteValidator', () => {
  describe('import row validation', () => {
    it('accepts an import of valid rows', () => {
      expect(() => v.validate({ subtype: 'import', rows: [validRow()] })).not.toThrow();
    });

    it('rejects an import row with a missing url', () => {
      const row = validRow();
      delete row.url;
      expect(() => v.validate({ subtype: 'import', rows: [row] })).toThrow(ValidationError);
    });

    it('rejects an import row with a mistyped field', () => {
      expect(() => v.validate({ subtype: 'import', rows: [validRow({ scroll_ratio: 5 })] })).toThrow(
        ValidationError,
      );
    });
  });

  describe('update value validation', () => {
    it('accepts valid changes', () => {
      expect(validateUpdateChanges({ title: 'new' })).toBeNull();
      expect(validateUpdateChanges({})).toBeNull();
      expect(validateUpdateChanges({ title: null, scroll_ratio: null, is_starred: null })).toBeNull();
    });

    it('rejects mistyped update values at the envelope', () => {
      expect(() => v.validate({ subtype: 'update', id: 1, changes: { title: 123 } })).toThrow(
        ValidationError,
      );
      expect(() => v.validate({ subtype: 'update', id: 1, changes: { scroll_ratio: 5 } })).toThrow(
        ValidationError,
      );
      expect(() => v.validate({ subtype: 'update', id: 1, changes: { is_starred: 2 } })).toThrow(
        ValidationError,
      );
    });

    it('still accepts an empty changes object at the envelope (the wire row owns the non-empty rule)', () => {
      expect(() => v.validate({ subtype: 'update', id: 1, changes: {} })).not.toThrow();
    });
  });
});
