import { describe, it, expect } from 'vitest';
import { DashboardSqliteValidator, ValidationError } from '../validators.js';
import { MAX_RESTORE_CHUNK_BASE64 } from '../../utils/limits.js';

/**
 * Wire-contract boundary pins for the chunked restore session subtypes.
 * The old single-shot restore_db capped the WHOLE DB at MAX_RESTORE_DB_BYTES
 * (10M chars ≒ 7.5MB), so large encrypted backups failed at restore time;
 * the session transport moves the per-message cap onto restore_chunk.data
 * (MAX_RESTORE_CHUNK_BASE64) and adds staging-name / offset / size fields.
 */
describe('DashboardSqliteValidator — restore session subtypes', () => {
  const v = new DashboardSqliteValidator();
  const STAGING = 'restore_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db';

  describe('restore_begin', () => {
    it('accepts the minimal session declaration', () => {
      expect(() => v.validate({ subtype: 'restore_begin', totalBytes: 1, totalChunks: 1 })).not.toThrow();
    });

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '8', null, undefined])(
      'rejects totalBytes = %p (positive integer required)',
      (totalBytes) => {
        expect(() =>
          v.validate({ subtype: 'restore_begin', totalBytes, totalChunks: 1 }),
        ).toThrow(ValidationError);
      },
    );

    it.each([0, -1, 2.5, '3', undefined])(
      'rejects totalChunks = %p (positive integer required)',
      (totalChunks) => {
        expect(() =>
          v.validate({ subtype: 'restore_begin', totalBytes: 8, totalChunks }),
        ).toThrow(ValidationError);
      },
    );
  });

  describe('restore_chunk', () => {
    it('accepts offset 0 and a chunk at the exact base64 cap', () => {
      const data = 'a'.repeat(MAX_RESTORE_CHUNK_BASE64);
      expect(() => v.validate({ subtype: 'restore_chunk', stagingName: STAGING, offset: 0, data })).not.toThrow();
    });

    it('rejects a chunk one char over the cap (per-message, not per-DB, bound)', () => {
      const data = 'a'.repeat(MAX_RESTORE_CHUNK_BASE64 + 1);
      expect(() => v.validate({ subtype: 'restore_chunk', stagingName: STAGING, offset: 0, data })).toThrow(
        /restore_chunk: data exceeds/,
      );
    });

    it.each([-1, 1.5, '0', null, undefined])(
      'rejects offset = %p (non-negative integer required)',
      (offset) => {
        expect(() =>
          v.validate({ subtype: 'restore_chunk', stagingName: STAGING, offset, data: 'ChQ=' }),
        ).toThrow(ValidationError);
      },
    );

    it.each([
      ['yasumaro.db', 'main DB as second engine'],
      ['archive_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db', 'archive prefix'],
      ['restore_incoming_not-a-uuid.db', 'wrong nonce shape'],
      ['restore_outgoing_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db', 'outgoing kind'],
      ['../../yasumaro.db', 'path traversal'],
      ['', 'empty'],
      [undefined, 'missing'],
    ])('rejects stagingName = %p (%s)', (stagingName: unknown, _note: unknown) => {
      expect(() =>
        v.validate({ subtype: 'restore_chunk', stagingName, offset: 0, data: 'ChQ=' }),
      ).toThrow(/stagingName/);
    });

    it('rejects a non-string data field', () => {
      expect(() =>
        v.validate({ subtype: 'restore_chunk', stagingName: STAGING, offset: 0, data: 12345 }),
      ).toThrow(ValidationError);
    });
  });

  describe('restore_commit', () => {
    it('accepts a declared size with the staging name', () => {
      expect(() =>
        v.validate({ subtype: 'restore_commit', stagingName: STAGING, totalBytes: 7_500_001 }),
      ).not.toThrow();
    });

    it.each([0, -1, 7.5, '8', undefined])('rejects totalBytes = %p', (totalBytes) => {
      expect(() =>
        v.validate({ subtype: 'restore_commit', stagingName: STAGING, totalBytes }),
      ).toThrow(ValidationError);
    });

    it('rejects an archive-prefixed staging name (families do not mix)', () => {
      expect(() =>
        v.validate({
          subtype: 'restore_commit',
          stagingName: 'archive_incoming_3f2504e0-4f89-41d3-9a0c-0305e82c3301.db',
          totalBytes: 8,
        }),
      ).toThrow(/stagingName/);
    });
  });

  describe('restore_abort', () => {
    it('accepts a registered-shape staging name', () => {
      expect(() => v.validate({ subtype: 'restore_abort', stagingName: STAGING })).not.toThrow();
    });

    it('rejects a malformed staging name', () => {
      expect(() => v.validate({ subtype: 'restore_abort', stagingName: 'yasumaro.db' })).toThrow(
        /stagingName/,
      );
    });
  });

  describe('removed single-shot subtype', () => {
    it('restore_db is no longer a known subtype (fail closed)', () => {
      expect(() => v.validate({ subtype: 'restore_db', data: 'ChQ=' })).toThrow(/Unknown subtype/);
    });
  });
});
