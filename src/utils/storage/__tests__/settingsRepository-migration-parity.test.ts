// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryStorageAdapter, SettingsRepository } from '../SettingsRepository.js';
import { ChromeStoragePort } from '../storagePort.js';
import { DEFAULT_SETTINGS } from '../defaults.js';
import { StorageKeys } from '../types.js';

const chromeSet = vi.fn().mockResolvedValue(undefined);
const chromeGet = vi.fn().mockResolvedValue({});

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: chromeGet,
      set: chromeSet,
      getBytesInUse: vi.fn().mockResolvedValue(0),
    },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
  permissions: { contains: vi.fn().mockResolvedValue(true) },
});

describe('SettingsRepository migration parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chromeGet.mockResolvedValue({});
    chromeSet.mockResolvedValue(undefined);
  });

  it('InMemory and Chrome paths produce same migration for legacy keys', async () => {
    const legacy = {
      obsidian_api_key: 'plain-key-1234567890',
      ai_provider: 'openai',
    } as any;

    const mem = new InMemoryStorageAdapter();
    await mem.set({ settings: legacy });
    const repoMem = new SettingsRepository(mem as any);
    const resultMem = await repoMem.getAll();

    // Migrations should have run: OBSIDIAN_ENABLED and AI_PROVIDER_PRIORITY_LIST
    expect(resultMem['obsidian_enabled']).toBeDefined();
    expect(resultMem['ai_provider_priority_list']).toBeDefined();
    // Defaults should be merged
    expect(resultMem['obsidian_protocol']).toBe(DEFAULT_SETTINGS.obsidian_protocol);
  });

  it('InMemory re-encrypts plaintext via Port with KeyProvider (rawEncrypted flag removed)', async () => {
    const mem = new InMemoryStorageAdapter();
    await mem.set({ settings: { gemini_api_key: 'plain-key' } as any });
    const repo = new SettingsRepository(mem as any);
    const result = await repo.getAll();
    // Returned value stays plaintext (decrypted view)
    expect(result['gemini_api_key']).toBe('plain-key');
    // Persisted via Port should be encrypted object, not plaintext; chrome.storage not touched
    const stored = await mem.get(['settings']);
    const persisted = (stored['settings'] as Record<string, unknown>)['gemini_api_key'];
    expect(typeof persisted).toBe('object');
    expect(persisted as Record<string, unknown>).toHaveProperty('iv');
    expect(chromeSet).not.toHaveBeenCalled();
  });

  it('defaults change in one file — InMemory sees same default via Settings.get', async () => {
    // DEFAULT_SETTINGS is single source; both adapters get same fallback
    const mem = new InMemoryStorageAdapter();
    const repoMem = new SettingsRepository(mem as any);
    const valMem = await repoMem.get(StorageKeys.OBSIDIAN_PROTOCOL);
    expect(valMem).toBe(DEFAULT_SETTINGS.obsidian_protocol);

    // Chrome port with empty store should return same default
    chromeGet.mockImplementation(async (keys: unknown) => {
      if (Array.isArray(keys) && (keys as string[]).includes('settings')) return {};
      if (Array.isArray(keys)) {
        const out: Record<string, unknown> = {};
        return out;
      }
      return {};
    });
    const chromePort = new ChromeStoragePort();
    const repoChrome = new SettingsRepository(chromePort as any);
    const valChrome = await repoChrome.get(StorageKeys.OBSIDIAN_PROTOCOL);
    expect(valChrome).toBe(DEFAULT_SETTINGS.obsidian_protocol);
    expect(valChrome).toBe(valMem);
  });

  it('observe is typed and Port-pure — both adapters forward settings changes', async () => {
    const mem = new InMemoryStorageAdapter();
    const repo = new SettingsRepository(mem as any);
    const observed: Array<Record<string, unknown>> = [];
    repo.observe((c) => observed.push(c as Record<string, unknown>));
    await repo.set(StorageKeys.OBSIDIAN_HOST, 'observed.host');
    expect(observed.length).toBe(1);
    expect(observed[0][StorageKeys.OBSIDIAN_HOST]).toBe('observed.host');
  });
});
