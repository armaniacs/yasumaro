import { describe, it, expect } from 'vitest';
import { createStorageAreaMock } from '../storageMock.js';

describe('createStorageAreaMock', () => {
  describe('get', () => {
    it('returns a promise of the whole store for null/undefined keys', async () => {
      const store: Record<string, any> = { a: 1 };
      const area = createStorageAreaMock(store, { clone: false });

      await expect(area.get(null)).resolves.toEqual({ a: 1 });
      await expect(area.get(undefined)).resolves.toEqual({ a: 1 });
    });

    it('returns only the requested key when it exists (string keys)', async () => {
      const store: Record<string, any> = { a: 1, b: 2 };
      const area = createStorageAreaMock(store, { clone: false });

      await expect(area.get('a')).resolves.toEqual({ a: 1 });
      await expect(area.get('missing')).resolves.toEqual({});
    });

    it('returns only the requested keys that exist (array keys)', async () => {
      const store: Record<string, any> = { a: 1, b: 2 };
      const area = createStorageAreaMock(store, { clone: false });

      await expect(area.get(['a', 'missing', 'b'])).resolves.toEqual({ a: 1, b: 2 });
    });

    it('hands out a clone on get when clone is true, so mutating the result leaves the store intact', async () => {
      const store: Record<string, any> = { nested: { value: 1 } };
      const area = createStorageAreaMock(store, { clone: true });

      const result = await area.get('nested');
      (result as Record<string, any>).nested.value = 999;

      expect(store.nested.value).toBe(1);
    });

    it('keeps the reference on get when clone is false', async () => {
      const store: Record<string, any> = { nested: { value: 1 } };
      const area = createStorageAreaMock(store, { clone: false });

      const result = await area.get('nested');
      (result as Record<string, any>).nested.value = 999;

      expect(store.nested.value).toBe(999);
    });
  });

  describe('set', () => {
    it('writes a clone when clone is true, so mutating the source afterwards leaves the store intact', async () => {
      const store: Record<string, any> = {};
      const area = createStorageAreaMock(store, { clone: true });
      const items = { nested: { value: 1 } };

      await area.set(items);
      items.nested.value = 999;

      expect(store.nested.value).toBe(1);
    });

    it('assigns the reference when clone is false', async () => {
      const store: Record<string, any> = {};
      const area = createStorageAreaMock(store, { clone: false });
      const items = { nested: { value: 1 } };

      await area.set(items);
      items.nested.value = 999;

      expect(store.nested.value).toBe(999);
    });
  });

  describe('optional methods', () => {
    it('removes a single key and an array of keys', async () => {
      const store: Record<string, any> = { a: 1, b: 2, c: 3 };
      const area = createStorageAreaMock(store, { clone: false, remove: true });

      await area.remove!('a');
      expect(store).toEqual({ b: 2, c: 3 });

      await area.remove!(['b', 'c']);
      expect(store).toEqual({});
    });

    it('clears the whole store', async () => {
      const store: Record<string, any> = { a: 1, b: 2 };
      const area = createStorageAreaMock(store, { clone: false, clear: true });

      await area.clear!();
      expect(store).toEqual({});
    });

    it('reports getBytesInUse as 1024', async () => {
      const area = createStorageAreaMock({}, { clone: false, getBytesInUse: true });

      await expect(area.getBytesInUse!()).resolves.toBe(1024);
    });

    it('omits remove/clear/getBytesInUse when their options are not set', () => {
      const area = createStorageAreaMock({}, { clone: false });

      expect(area.remove).toBeUndefined();
      expect(area.clear).toBeUndefined();
      expect(area.getBytesInUse).toBeUndefined();
    });
  });
});
