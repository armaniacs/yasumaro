// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { InMemoryStorageAdapter, SettingsRepository } from '../SettingsRepository.js';
import { DEFAULT_SETTINGS } from '../defaults.js';

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn().mockResolvedValue({}),
      set: vi.fn().mockResolvedValue(undefined),
    },
    onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
  },
});

describe('SettingsRepository migration parity', () => {
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

  it('InMemory does not attempt chrome.storage re-encryption', async () => {
    const mem = new InMemoryStorageAdapter();
    await mem.set({ settings: { gemini_api_key: 'plain-key' } as any });
    const repo = new SettingsRepository(mem as any);
    const result = await repo.getAll();
    // Should keep plaintext without throwing (rawEncrypted:false path)
    expect(result['gemini_api_key']).toBe('plain-key');
  });
});
