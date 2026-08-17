/**
 * managedStringList.test.ts
 * Unit tests for the generic add/remove/getAll collection extracted from
 * trustDb.ts's duplicated CRUD pairs (userTlds/sensitive.userBlacklist/
 * sensitive.whitelist).
 */
import { vi } from 'vitest';
import { ManagedStringList } from '../managedStringList.js';

describe('ManagedStringList', () => {
  it('adds a new item and calls save()', async () => {
    const items: string[] = [];
    const save = vi.fn().mockResolvedValue(undefined);
    const list = new ManagedStringList(items, { save });

    const result = await list.add('example.com');

    expect(result.success).toBe(true);
    expect(items).toEqual(['example.com']);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate add without calling save()', async () => {
    const items = ['example.com'];
    const save = vi.fn().mockResolvedValue(undefined);
    const list = new ManagedStringList(items, { save });

    const result = await list.add('example.com');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Domain already exists');
    expect(save).not.toHaveBeenCalled();
  });

  it('uses a custom duplicate error message when provided', async () => {
    const items = ['.jp'];
    const list = new ManagedStringList(items, {
      save: vi.fn().mockResolvedValue(undefined),
      duplicateErrorMessage: 'TLD already exists',
    });

    const result = await list.add('.jp');

    expect(result.error).toBe('TLD already exists');
  });

  it('normalizes an item before comparing/storing it', async () => {
    const items: string[] = [];
    const list = new ManagedStringList(items, {
      save: vi.fn().mockResolvedValue(undefined),
      normalize: (v) => v.toLowerCase().trim(),
    });

    await list.add('  Example.COM  ');

    expect(items).toEqual(['example.com']);
  });

  it('rejects an item that fails validation without mutating the list', async () => {
    const items: string[] = [];
    const save = vi.fn().mockResolvedValue(undefined);
    const list = new ManagedStringList(items, {
      save,
      validate: () => ({ valid: false, error: 'Invalid format' }),
    });

    const result = await list.add('bad-value');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid format');
    expect(items).toEqual([]);
    expect(save).not.toHaveBeenCalled();
  });

  it('removes an existing item and calls save()', async () => {
    const items = ['a.com', 'b.com'];
    const save = vi.fn().mockResolvedValue(undefined);
    const list = new ManagedStringList(items, { save });

    const result = await list.remove('a.com');

    expect(result.success).toBe(true);
    expect(items).toEqual(['b.com']);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('fails to remove a missing item without calling save()', async () => {
    const items = ['a.com'];
    const save = vi.fn().mockResolvedValue(undefined);
    const list = new ManagedStringList(items, { save });

    const result = await list.remove('missing.com');

    expect(result.success).toBe(false);
    expect(result.error).toBe('Domain not found');
    expect(save).not.toHaveBeenCalled();
  });

  it('uses a custom not-found error message when provided', async () => {
    const list = new ManagedStringList([], {
      save: vi.fn().mockResolvedValue(undefined),
      notFoundErrorMessage: 'TLD not found',
    });

    const result = await list.remove('.missing');

    expect(result.error).toBe('TLD not found');
  });

  it('getAll returns a copy, not the backing array', () => {
    const items = ['a.com', 'b.com'];
    const list = new ManagedStringList(items, { save: vi.fn() });

    const snapshot = list.getAll();
    snapshot.push('mutated.com');

    expect(items).toEqual(['a.com', 'b.com']);
  });
});
