import { describe, it, expect } from 'vitest';
import { normalizeStorageQuery } from '../queryNormalize.js';

describe('normalizeStorageQuery — alias families', () => {
  it('passes limit/offset through Number coercion', () => {
    expect(normalizeStorageQuery({ limit: '10', offset: '5' })).toMatchObject({ limit: 10, offset: 5 });
    expect(normalizeStorageQuery({})).not.toHaveProperty('limit');
    expect(normalizeStorageQuery({ limit: null })).not.toHaveProperty('limit');
  });

  it('passes orderBy/orderDir through unchanged', () => {
    expect(normalizeStorageQuery({ orderBy: 'rank', orderDir: 'ASC' })).toMatchObject({
      orderBy: 'rank',
      orderDir: 'ASC',
    });
  });

  it('prefers starred over isStarred, coerces to boolean', () => {
    expect(normalizeStorageQuery({ starred: 1 })).toMatchObject({ starred: true });
    expect(normalizeStorageQuery({ isStarred: 1 })).toMatchObject({ starred: true });
    expect(normalizeStorageQuery({ isStarred: 0 })).toMatchObject({ starred: false });
    expect(normalizeStorageQuery({ starred: null, isStarred: 1 })).toMatchObject({ starred: true });
    expect(normalizeStorageQuery({})).not.toHaveProperty('starred');
  });

  it('prefers dateFrom over since, dateTo over until', () => {
    expect(normalizeStorageQuery({ dateFrom: '1000' })).toMatchObject({ dateFrom: 1000 });
    expect(normalizeStorageQuery({ since: '2000' })).toMatchObject({ dateFrom: 2000 });
    expect(normalizeStorageQuery({ dateFrom: null, since: '3000' })).toMatchObject({ dateFrom: 3000 });
    expect(normalizeStorageQuery({})).not.toHaveProperty('dateFrom');
    expect(normalizeStorageQuery({ dateTo: '100' })).toMatchObject({ dateTo: 100 });
    expect(normalizeStorageQuery({ until: '200' })).toMatchObject({ dateTo: 200 });
    expect(normalizeStorageQuery({})).not.toHaveProperty('dateTo');
  });

  it('prefers tag over tagFilter, coerces domain to string', () => {
    expect(normalizeStorageQuery({ tag: 'a' })).toMatchObject({ tag: 'a' });
    expect(normalizeStorageQuery({ tagFilter: 'b' })).toMatchObject({ tag: 'b' });
    expect(normalizeStorageQuery({ tag: null, tagFilter: 'c' })).toMatchObject({ tag: 'c' });
    expect(normalizeStorageQuery({ domain: 123 })).toMatchObject({ domain: '123' });
  });

  it('coerces gistSynced and excludeDeleted', () => {
    expect(normalizeStorageQuery({ gistSynced: '1' })).toMatchObject({ gistSynced: 1 });
    expect(normalizeStorageQuery({ gistSynced: null })).not.toHaveProperty('gistSynced');
    expect(normalizeStorageQuery({ excludeDeleted: 1 })).toMatchObject({ excludeDeleted: true });
  });

  it('passes ids through by reference shape', () => {
    expect(normalizeStorageQuery({ ids: [9] })).toMatchObject({ ids: [9] });
    expect(normalizeStorageQuery({})).not.toHaveProperty('ids');
  });

  it('drops unknown keys', () => {
    expect(normalizeStorageQuery({ unknownField: 'x', limit: 5 })).toEqual({ limit: 5 });
    expect(normalizeStorageQuery({})).toEqual({});
  });
});
