import { describe, test, expect, vi } from 'vitest';
import { SensitiveDomainStore } from '../sensitiveDomainStore.js';
import { ManagedStringList } from '../managedStringList.js';

describe('SensitiveDomainStore', () => {
  function setup() {
    const save = vi.fn().mockResolvedValue(undefined);
    const userBlacklist: string[] = [];
    const list = new ManagedStringList(userBlacklist, { save });
    const presets = { finance: ['bank.example'], gaming: ['game.example'], sns: ['social.example'] };
    const store = new SensitiveDomainStore(list, () => presets);
    return { store, save, userBlacklist, presets };
  }

  test('getSensitiveDomains はプリセットとユーザーブラックリストを結合する', async () => {
    const { store } = setup();
    await store.addSensitiveDomain('extra.example');
    expect(store.getSensitiveDomains('finance')).toEqual(['bank.example', 'extra.example']);
  });

  test('addSensitiveDomain は ManagedStringList に委譲する', async () => {
    const { store, save, userBlacklist } = setup();
    const result = await store.addSensitiveDomain('new.example');
    expect(result.success).toBe(true);
    expect(userBlacklist).toContain('new.example');
    expect(save).toHaveBeenCalledTimes(1);
  });

  test('removeSensitiveDomain は ManagedStringList に委譲する', async () => {
    const { store, userBlacklist } = setup();
    await store.addSensitiveDomain('to-remove.example');
    const result = await store.removeSensitiveDomain('to-remove.example');
    expect(result.success).toBe(true);
    expect(userBlacklist).not.toContain('to-remove.example');
  });

  test('存在しないドメインの削除は失敗を返す', async () => {
    const { store } = setup();
    const result = await store.removeSensitiveDomain('missing.example');
    expect(result.success).toBe(false);
  });
});
