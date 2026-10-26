/**
 * savedCollections.test.ts
 * Table tests for the saved-collection normalizer (PBI 2026-10-23-06).
 *
 * The contract: a valid collection keeps its fields, and unknown input fails
 * closed to null so corrupted entries drop from the list.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeSavedCollection,
  normalizeSavedCollections,
  upsertSavedCollection,
  duplicateSavedCollection,
  removeSavedCollection,
  type SavedCollection,
} from '../savedCollections.js';

describe('normalizeSavedCollection', () => {
  it('keeps a valid collection with its fields', () => {
    const result = normalizeSavedCollection('c1', {
      name: 'ML papers',
      query: { q: 'transformers', starred: true },
      createdAt: 100,
      updatedAt: 200,
    });
    expect(result).toEqual({ id: 'c1', name: 'ML papers', query: { q: 'transformers', starred: true }, createdAt: 100, updatedAt: 200 });
  });

  it('falls back updatedAt to createdAt when absent', () => {
    const result = normalizeSavedCollection('c1', { name: 'n', query: {}, createdAt: 50 });
    expect(result?.updatedAt).toBe(50);
  });

  it('returns null when the name is missing', () => {
    expect(normalizeSavedCollection('c1', { query: {}, createdAt: 1 })).toBeNull();
  });

  it('returns null when createdAt is missing or invalid', () => {
    expect(normalizeSavedCollection('c1', { name: 'n', query: {} })).toBeNull();
    expect(normalizeSavedCollection('c1', { name: 'n', query: {}, createdAt: 'x' })).toBeNull();
  });

  it('returns null for a non-object raw or a blank id', () => {
    expect(normalizeSavedCollection('c1', 'junk')).toBeNull();
    expect(normalizeSavedCollection('', { name: 'n', query: {}, createdAt: 1 })).toBeNull();
  });
});

describe('normalizeSavedCollections', () => {
  it('drops corrupted entries and keeps valid ones', () => {
    const result = normalizeSavedCollections({
      ok: { name: 'n', query: {}, createdAt: 1 },
      junk: 'not-an-object',
    });
    expect(Object.keys(result)).toEqual(['ok']);
  });

  it('returns an empty map for non-object input', () => {
    expect(normalizeSavedCollections(undefined)).toEqual({});
    expect(normalizeSavedCollections('junk')).toEqual({});
  });
});

describe('upsertSavedCollection', () => {
  it('inserts a new collection stamping createdAt and updatedAt', () => {
    const result = upsertSavedCollection({}, 'c1', 'n', { q: 'x' }, 100);
    expect(result['c1']).toEqual({ id: 'c1', name: 'n', query: { q: 'x' }, createdAt: 100, updatedAt: 100 });
  });

  it('renames without moving createdAt (PBI 2026-10-23-06: 件数と更新時刻が分かる)', () => {
    const base = upsertSavedCollection({}, 'c1', 'n', {}, 100);
    const renamed = upsertSavedCollection(base, 'c1', 'renamed', {}, 200);
    expect(renamed['c1']?.createdAt).toBe(100);
    expect(renamed['c1']?.updatedAt).toBe(200);
    expect(renamed['c1']?.name).toBe('renamed');
  });

  it('does not mutate the input map', () => {
    const base = upsertSavedCollection({}, 'c1', 'n', {}, 100);
    upsertSavedCollection(base, 'c1', 'changed', {}, 200);
    expect(base['c1']?.name).toBe('n');
  });
});

describe('removeSavedCollection', () => {
  it('drops only the named collection', () => {
    const base = upsertSavedCollection({}, 'c1', 'a', {}, 100);
    const withTwo = upsertSavedCollection(base, 'c2', 'b', {}, 100);
    const removed = removeSavedCollection(withTwo, 'c1');
    expect(Object.keys(removed)).toEqual(['c2']);
  });

  it('is a no-op for a missing id', () => {
    const result = removeSavedCollection({}, 'missing');
    expect(result).toEqual({});
  });

  // Boundary: special keys must stay own data properties, never relink the prototype.
  it.each(['__proto__', 'constructor', 'prototype'])(
    'keeps own special key %s as data when removing another entry',
    (specialKey) => {
      const kept = { id: 'c1', name: 'a', query: {}, createdAt: 100, updatedAt: 100 };
      const special = { id: specialKey, name: 'special', query: {}, createdAt: 10, updatedAt: 10 };
      const contaminated = Object.fromEntries([
        ['c1', kept],
        [specialKey, special],
      ]) as Record<string, SavedCollection>;
      const removed = removeSavedCollection(contaminated, 'c1');
      expect(Object.prototype.hasOwnProperty.call(removed, specialKey)).toBe(true);
      expect(removed[specialKey]).toEqual(special);
      expect(Object.getPrototypeOf(removed)).toBe(Object.prototype);
    },
  );

  it('removes the __proto__ key itself without relinking the prototype', () => {
    const kept = { id: 'c1', name: 'a', query: {}, createdAt: 100, updatedAt: 100 };
    const special = { id: '__proto__', name: 'special', query: {}, createdAt: 10, updatedAt: 10 };
    const contaminated = Object.fromEntries([
      ['c1', kept],
      ['__proto__', special],
    ]) as Record<string, SavedCollection>;
    const removed = removeSavedCollection(contaminated, '__proto__');
    expect(Object.keys(removed)).toEqual(['c1']);
    expect(removed['c1']).toEqual(kept);
    expect(Object.getPrototypeOf(removed)).toBe(Object.prototype);
  });
});

describe('duplicateSavedCollection', () => {
  it('copies the query under a new id with fresh timestamps', () => {
    const base = upsertSavedCollection({}, 'c1', 'a', { q: 'x' }, 100);
    const duped = duplicateSavedCollection(base, 'c1', 'c2', 'a copy', 200);
    expect(duped['c2']).toEqual({ id: 'c2', name: 'a copy', query: { q: 'x' }, createdAt: 200, updatedAt: 200 });
    expect(duped['c1']).toEqual(base['c1']);
  });

  it('is a no-op for a missing id, blank new id, or self-copy', () => {
    const base = upsertSavedCollection({}, 'c1', 'a', {}, 100);
    expect(duplicateSavedCollection(base, 'missing', 'c2', 'x', 200)).toBe(base);
    expect(duplicateSavedCollection(base, 'c1', '', 'x', 200)).toBe(base);
    expect(duplicateSavedCollection(base, 'c1', 'c1', 'x', 200)).toBe(base);
  });
});
