import { describe, test, expect, vi } from 'vitest';
import { WhitelistStore } from '../whitelistStore.js';
import { ManagedStringList } from '../managedStringList.js';

describe('WhitelistStore', () => {
  function setup() {
    const save = vi.fn().mockResolvedValue(undefined);
    const whitelist: string[] = [];
    const list = new ManagedStringList(whitelist, { save });
    const store = new WhitelistStore(list);
    return { store, save, whitelist };
  }

  test('getWhitelist は現在のリストのコピーを返す', async () => {
    const { store } = setup();
    await store.addToWhitelist('allowed.example');
    const result = store.getWhitelist();
    expect(result).toEqual(['allowed.example']);
  });

  test('addToWhitelist は ManagedStringList に委譲する', async () => {
    const { store, save, whitelist } = setup();
    const result = await store.addToWhitelist('new.example');
    expect(result.success).toBe(true);
    expect(whitelist).toContain('new.example');
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('removeFromWhitelist は ManagedStringList に委譲する', async () => {
    const { store, whitelist } = setup();
    await store.addToWhitelist('to-remove.example');
    const result = await store.removeFromWhitelist('to-remove.example');
    expect(result.success).toBe(true);
    expect(whitelist).not.toContain('to-remove.example');
  });

  test('存在しないドメインの削除は失敗を返す', async () => {
    const { store } = setup();
    const result = await store.removeFromWhitelist('missing.example');
    expect(result.success).toBe(false);
  });
});
