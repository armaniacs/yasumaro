/**
 * browsingLogCodec-validation.test.ts (PBI 2026-11-08-06)
 *
 * validateRecordForInsert is the final defense before a record reaches the
 * backend: it rejects the values lenient coercion cannot save (CHECK-
 * violating finite numbers, non-string urls, objects where text belongs)
 * while leaving every pinned coercion (numeric strings, booleans for flags,
 * null/undefined, NaN neutralization) untouched.
 */
import { describe, it, expect } from 'vitest';
import { validateRecordForInsert } from '../browsingLogCodec.js';

describe('browsingLogCodec', () => {
  describe('validateRecordForInsert', () => {
    it('accepts a minimal valid record', () => {
      expect(validateRecordForInsert({ url: 'https://example.com', created_at: 1000 })).toBeNull();
    });

    it('rejects a missing url (no silent empty-string row)', () => {
      expect(validateRecordForInsert({})).toContain('url');
      expect(validateRecordForInsert({ created_at: 1000 })).toContain('url');
    });

    it('rejects a null or empty url', () => {
      expect(validateRecordForInsert({ url: null })).toContain('url');
      expect(validateRecordForInsert({ url: '' })).toContain('url');
    });

    it('accepts legacy coercible values unchanged', () => {
      expect(validateRecordForInsert({ url: 'https://a.com', visit_duration: '30000' })).toBeNull();
      expect(validateRecordForInsert({ url: 'https://a.com', is_starred: true })).toBeNull();
      expect(validateRecordForInsert({ url: 'https://a.com', title: null, scroll_ratio: null })).toBeNull();
    });

    it('rejects a non-object payload', () => {
      expect(validateRecordForInsert(null)).not.toBeNull();
      expect(validateRecordForInsert('https://a.com')).not.toBeNull();
      expect(validateRecordForInsert([{ url: 'https://a.com' }])).not.toBeNull();
    });

    it('rejects a non-string url', () => {
      expect(validateRecordForInsert({ url: 123 })).toContain('url');
      expect(validateRecordForInsert({ url: { text: 'x' } })).toContain('url');
    });

    it('rejects an object where text belongs', () => {
      expect(validateRecordForInsert({ url: 'https://a.com', title: { text: 'x' } })).toContain('title');
    });

    it('rejects a negative visit_duration', () => {
      expect(validateRecordForInsert({ url: 'https://a.com', visit_duration: -1 })).toContain(
        'visit_duration',
      );
    });

    it('rejects an out-of-range scroll_ratio', () => {
      expect(validateRecordForInsert({ url: 'https://a.com', scroll_ratio: 5 })).toContain('scroll_ratio');
    });

    it('rejects a non-0/1 flag number', () => {
      expect(validateRecordForInsert({ url: 'https://a.com', is_starred: 2 })).toContain('is_starred');
      expect(validateRecordForInsert({ url: 'https://a.com', is_deleted: 2 })).toContain('is_deleted');
    });
  });
});
