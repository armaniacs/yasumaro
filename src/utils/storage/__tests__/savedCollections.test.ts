/**
 * savedCollections.test.ts
 * Table tests for the saved-collection normalizer (PBI 2026-10-23-06).
 *
 * The contract: a valid collection keeps its fields, and unknown input fails
 * closed to null so corrupted entries drop from the list.
 */

import { describe, it, expect } from 'vitest';
import { normalizeSavedCollection, normalizeSavedCollections } from '../savedCollections.js';

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
