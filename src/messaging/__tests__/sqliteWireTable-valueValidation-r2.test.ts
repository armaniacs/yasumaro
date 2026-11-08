/**
 * sqliteWireTable-valueValidation-r2.test.ts (PBI 2026-11-08-06)
 *
 * encodeOp used to wrap whatever it was given and the update dashboard
 * validate checked only id + non-empty, so mistyped values reached the SQL
 * layer. These tests pin value validation at op construction and at the
 * dashboard validate gate.
 */
import { describe, it, expect } from 'vitest';
import { SQLITE_WIRE_DESCRIPTORS } from '../sqliteWireTable.js';

const updateValidate = SQLITE_WIRE_DESCRIPTORS.update.dashboard?.validate;

describe('messaging/sqliteWireTable: update value validation', () => {
  describe('dashboard validate', () => {
    it('accepts well-typed changes', () => {
      expect(updateValidate?.({ id: 1, changes: { title: 'x', scroll_ratio: 0.5, is_starred: 1 } })).toBeNull();
    });

    it('rejects a mistyped title', () => {
      expect(updateValidate?.({ id: 1, changes: { title: 123 } })).toContain('title');
    });

    it('rejects an out-of-range scroll_ratio', () => {
      expect(updateValidate?.({ id: 1, changes: { scroll_ratio: 5 } })).toContain('scroll_ratio');
    });

    it('rejects a non-flag is_starred', () => {
      expect(updateValidate?.({ id: 1, changes: { is_starred: 2 } })).toContain('is_starred');
    });

    it('rejects an empty url', () => {
      expect(updateValidate?.({ id: 1, changes: { url: '' } })).toContain('url');
    });

    it('rejects an array changes object', () => {
      expect(updateValidate?.({ id: 1, changes: [] })).not.toBeNull();
    });

    it('still rejects empty and missing changes', () => {
      expect(updateValidate?.({ id: 1, changes: {} })).not.toBeNull();
      expect(updateValidate?.({ id: 1 })).not.toBeNull();
    });
  });

  describe('update encodeOp', () => {
    it('throws on a non-positive id', () => {
      expect(() => SQLITE_WIRE_DESCRIPTORS.update.encodeOp(0, { title: 'x' })).toThrow(TypeError);
    });

    it('throws on invalid changes', () => {
      expect(() => SQLITE_WIRE_DESCRIPTORS.update.encodeOp(7, { scroll_ratio: 5 })).toThrow(TypeError);
    });

    it('builds a valid op unchanged', () => {
      const op = SQLITE_WIRE_DESCRIPTORS.update.encodeOp(7, { title: 'n' });
      expect(op).toEqual({ type: 'update', id: 7, changes: { title: 'n' } });
    });

    it('carries the validated rest on the op, not the original changes with id', () => {
      const op = SQLITE_WIRE_DESCRIPTORS.update.encodeOp(7, { id: 99, title: 'n' } as never);
      expect(op.changes).toEqual({ title: 'n' });
      expect('id' in (op.changes as Record<string, unknown>)).toBe(false);
    });
  });

  describe('insertBatch encodeOp', () => {
    it('throws on a non-array payload', () => {
      expect(() => SQLITE_WIRE_DESCRIPTORS.insertBatch.encodeOp('nope' as never)).toThrow(TypeError);
    });

    it('throws on a row without a url', () => {
      expect(() => SQLITE_WIRE_DESCRIPTORS.insertBatch.encodeOp([{ created_at: 1 } as never])).toThrow(
        /record 0.*url/,
      );
    });

    it('throws on a row with a non-flag value', () => {
      expect(() =>
        SQLITE_WIRE_DESCRIPTORS.insertBatch.encodeOp([
          { url: 'https://a.com', created_at: 1, is_starred: 2 } as never,
        ]),
      ).toThrow(/record 0.*is_starred/);
    });

    it('builds a valid batch unchanged', () => {
      const records = [
        { url: 'https://a.com', created_at: 1 },
        { url: 'https://b.com', created_at: 2, title: 'B' },
      ];
      const op = SQLITE_WIRE_DESCRIPTORS.insertBatch.encodeOp(records as never);
      expect(op).toEqual({ type: 'insertBatch', records });
    });
  });
});
