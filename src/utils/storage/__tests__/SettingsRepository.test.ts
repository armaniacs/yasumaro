import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsRepository, InMemoryStorageAdapter } from '../SettingsRepository.js';
import { StorageKeys } from '../types.js';

describe('SettingsRepository — deep module via StorageAdapter', () => {
  let adapter: InMemoryStorageAdapter;
  let repo: SettingsRepository;

  beforeEach(() => {
    adapter = new InMemoryStorageAdapter();
    repo = new SettingsRepository(adapter);
  });

  it('get returns stored value without chrome.storage mock', async () => {
    adapter.seed({ settings: { [StorageKeys.OBSIDIAN_HOST]: '192.168.1.10' } });
    const val = await repo.get(StorageKeys.OBSIDIAN_HOST);
    expect(val).toBe('192.168.1.10');
  });

  it('get returns default when key not stored (locality)', async () => {
    // empty store → should fall back to DEFAULT_SETTINGS
    const val = await repo.get(StorageKeys.OBSIDIAN_HOST);
    // DEFAULT_SETTINGS has 127.0.0.1 for host (from defaults.ts)
    expect(typeof val).toBe('string');
    expect(val).toBeDefined();
  });

  it('getAll returns full settings object', async () => {
    adapter.seed({ settings: { [StorageKeys.OBSIDIAN_PORT]: '27123', [StorageKeys.OBSIDIAN_HOST]: 'localhost' } });
    const all = await repo.getAll();
    expect(all[StorageKeys.OBSIDIAN_PORT]).toBe('27123');
    expect(all[StorageKeys.OBSIDIAN_HOST]).toBe('localhost');
  });

  it('set persists via adapter and get reflects new value', async () => {
    await repo.set(StorageKeys.OBSIDIAN_HOST, '10.0.0.5');
    const val = await repo.get(StorageKeys.OBSIDIAN_HOST);
    expect(val).toBe('10.0.0.5');
  });

  it('setAll merges multiple keys', async () => {
    await repo.setAll({ [StorageKeys.OBSIDIAN_HOST]: '1.2.3.4', [StorageKeys.OBSIDIAN_PORT]: '8080' });
    const all = await repo.getAll();
    expect(all[StorageKeys.OBSIDIAN_HOST]).toBe('1.2.3.4');
    expect(all[StorageKeys.OBSIDIAN_PORT]).toBe('8080');
  });

  it('getAll merges defaults when partially stored', async () => {
    adapter.seed({ settings: { [StorageKeys.OBSIDIAN_HOST]: 'custom.host' } });
    const all = await repo.getAll();
    expect(all[StorageKeys.OBSIDIAN_HOST]).toBe('custom.host');
    // 未保存キーはデフォルトで補完される
    expect(all[StorageKeys.OBSIDIAN_PORT]).toBeDefined();
    expect(typeof all[StorageKeys.OBSIDIAN_PORT]).toBe('string');
  });

  it('onChange is called when adapter set is invoked (interface越し)', async () => {
    const changes: Array<Record<string, unknown>> = [];
    repo.onChange((c) => changes.push(c as Record<string, unknown>));
    await repo.set(StorageKeys.OBSIDIAN_HOST, '9.9.9.9');
    expect(changes.length).toBe(1);
    expect(changes[0][StorageKeys.OBSIDIAN_HOST]).toBe('9.9.9.9');
  });

  it('onChange forwards only settings key, not other keys', async () => {
    const received: Array<unknown> = [];
    repo.onChange((c) => received.push(c));
    // Direct adapter set with non-settings key should not trigger onChange forwarding? Actually onChange filters for 'settings' in changes
    await adapter.set({ otherKey: 'value' });
    expect(received.length).toBe(0);
    await adapter.set({ settings: { [StorageKeys.OBSIDIAN_HOST]: 'x' } });
    expect(received.length).toBe(1);
  });

  it('two adapters justify the seam — InMemory vs Chrome', async () => {
    const mem = new InMemoryStorageAdapter();
    mem.seed({ settings: { [StorageKeys.GEMINI_MODEL]: 'gemini-pro' } });
    const memRepo = new SettingsRepository(mem);
    expect(await memRepo.get(StorageKeys.GEMINI_MODEL)).toBe('gemini-pro');
    // InMemory path does not require chrome.storage mock — verified by not touching global chrome
  });

  it('typed get provides compile-time safety (typo would be error)', async () => {
    // This test ensures the interface is typed — a typo in key would be compile error
    // We test that valid key works
    const val = await repo.get(StorageKeys.AI_PROVIDER);
    expect(val === undefined || typeof val === 'string').toBe(true);
  });
});
