import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import { InMemoryStoragePort } from '../../src/utils/storage/InMemoryStoragePort.js';
import { SettingsRepository } from '../../src/utils/storage/SettingsRepository.js';
import { StorageKeys } from '../../src/utils/storage/types.js';
import { collectBProviderPrioritySlots, createBPriorityListView } from '../../src/dashboard/aiProviderB/priorityListView.js';
import { collectProviderPrioritySlots, applyProviderPrioritySlots } from '../../src/dashboard/generalSettings/settingsForm.js';

function setupADom(): void {
  const dom = new JSDOM(`
    <select id="aiProvider"><option value="gemini">gemini</option><option value="openai">openai</option><option value="ollama">ollama</option></select>
    <input id="aiProviderPriority1Model" />
    <select id="aiProviderPriority2"><option value=""></option><option value="gemini">gemini</option><option value="openai">openai</option><option value="ollama">ollama</option></select>
    <input id="aiProviderPriority2Model" />
    <select id="aiProviderPriority3"><option value=""></option><option value="gemini">gemini</option><option value="openai">openai</option><option value="ollama">ollama</option></select>
    <input id="aiProviderPriority3Model" />
  `);
  (globalThis as unknown as Record<string, unknown>).document = dom.window.document as unknown as Document;
  (globalThis as unknown as Record<string, unknown>).window = dom.window as unknown as Window;
}

function setupBContainer(initial: { provider: string; model?: string }[] = []): HTMLElement {
  const dom = new JSDOM('<div id="bPriorityList"></div>');
  // B view は global.document を使うため上書き
  (globalThis as unknown as Record<string, unknown>).document = dom.window.document as unknown as Document;
  (globalThis as unknown as Record<string, unknown>).window = dom.window as unknown as Window;
  const container = dom.window.document.getElementById('bPriorityList') as HTMLElement;
  // 明示的にB viewを構築せずとも collect は DOM を読むが、テストの一貫性のため view を作る
  createBPriorityListView(container, initial);
  return container;
}

describe('AI provider layout integration', () => {
  it('AとBどちらから保存しても同じキーに書き込まれる', async () => {
    const port = new InMemoryStoragePort();
    const repo = new SettingsRepository(port);
    await repo.set(StorageKeys.AI_PROVIDER_PRIORITY_LIST, [{ provider: 'openai', model: 'x' }]);
    const stored = await repo.get(StorageKeys.AI_PROVIDER_PRIORITY_LIST);
    expect(stored).toEqual([{ provider: 'openai', model: 'x' }]);
  });

  it('A(DOM)で収集したスロットを保存すると同じキーから読める', async () => {
    setupADom();
    const aiProvider = document.getElementById('aiProvider') as HTMLSelectElement;
    const m1 = document.getElementById('aiProviderPriority1Model') as HTMLInputElement;
    const p2 = document.getElementById('aiProviderPriority2') as HTMLSelectElement;
    const m2 = document.getElementById('aiProviderPriority2Model') as HTMLInputElement;
    aiProvider.value = 'openai';
    m1.value = 'gpt-4o';
    p2.value = 'gemini';
    m2.value = '';

    const slots = collectProviderPrioritySlots();
    expect(slots).toEqual([{ provider: 'openai', model: 'gpt-4o' }, { provider: 'gemini' }]);

    const port = new InMemoryStoragePort();
    const repo = new SettingsRepository(port);
    await repo.set(StorageKeys.AI_PROVIDER_PRIORITY_LIST, slots);
    const stored = await repo.get(StorageKeys.AI_PROVIDER_PRIORITY_LIST);
    expect(stored).toEqual(slots);
  });

  it('B(DOM)で収集したスロットを保存すると同じキーから読める', async () => {
    const container = setupBContainer([{ provider: 'ollama', model: 'llama3' }, { provider: 'gemini' }]);
    const slots = collectBProviderPrioritySlots(container);
    expect(slots).toEqual([{ provider: 'ollama', model: 'llama3' }, { provider: 'gemini' }]);

    const port = new InMemoryStoragePort();
    const repo = new SettingsRepository(port);
    await repo.set(StorageKeys.AI_PROVIDER_PRIORITY_LIST, slots);
    const stored = await repo.get(StorageKeys.AI_PROVIDER_PRIORITY_LIST);
    expect(stored).toEqual(slots);
  });

  it('Aで保存後にBで上書きすると同じキーがBの値で更新される', async () => {
    const port = new InMemoryStoragePort();
    const repo = new SettingsRepository(port);

    // Aで保存
    setupADom();
    (document.getElementById('aiProvider') as HTMLSelectElement).value = 'openai';
    (document.getElementById('aiProviderPriority1Model') as HTMLInputElement).value = 'gpt-4o';
    (document.getElementById('aiProviderPriority2') as HTMLSelectElement).value = 'gemini';
    const aSlots = collectProviderPrioritySlots();
    await repo.set(StorageKeys.AI_PROVIDER_PRIORITY_LIST, aSlots);
    expect(await repo.get(StorageKeys.AI_PROVIDER_PRIORITY_LIST)).toEqual(aSlots);

    // Bで上書き
    const bContainer = setupBContainer([{ provider: 'ollama' }, { provider: 'openai', model: 'x' }]);
    const bSlots = collectBProviderPrioritySlots(bContainer);
    await repo.set(StorageKeys.AI_PROVIDER_PRIORITY_LIST, bSlots);
    const final = await repo.get(StorageKeys.AI_PROVIDER_PRIORITY_LIST);
    expect(final).toEqual(bSlots);
    expect(final).not.toEqual(aSlots);
  });

  it('Bで保存後にAで上書きすると同じキーがAの値で更新される', async () => {
    const port = new InMemoryStoragePort();
    const repo = new SettingsRepository(port);

    // Bで保存
    const bContainer = setupBContainer([{ provider: 'gemini', model: 'flash' }]);
    const bSlots = collectBProviderPrioritySlots(bContainer);
    await repo.set(StorageKeys.AI_PROVIDER_PRIORITY_LIST, bSlots);
    expect(await repo.get(StorageKeys.AI_PROVIDER_PRIORITY_LIST)).toEqual(bSlots);

    // Aで上書き
    setupADom();
    applyProviderPrioritySlots([{ provider: 'openai', model: 'x' }]);
    const aSlots = collectProviderPrioritySlots();
    await repo.set(StorageKeys.AI_PROVIDER_PRIORITY_LIST, aSlots);
    const final = await repo.get(StorageKeys.AI_PROVIDER_PRIORITY_LIST);
    expect(final).toEqual([{ provider: 'openai', model: 'x' }]);
  });

  it('AI_PROVIDER_LAYOUT が a/b どちらでも priority_list は同一キーに保存される', async () => {
    const port = new InMemoryStoragePort();
    const repo = new SettingsRepository(port);

    await repo.set(StorageKeys.AI_PROVIDER_LAYOUT, 'a');
    await repo.set(StorageKeys.AI_PROVIDER_PRIORITY_LIST, [{ provider: 'openai' }]);
    expect(await repo.get(StorageKeys.AI_PROVIDER_PRIORITY_LIST)).toEqual([{ provider: 'openai' }]);

    await repo.set(StorageKeys.AI_PROVIDER_LAYOUT, 'b');
    // layout切替後も同じキーにBのスロットを保存
    const bContainer = setupBContainer([{ provider: 'ollama' }]);
    const bSlots = collectBProviderPrioritySlots(bContainer);
    await repo.set(StorageKeys.AI_PROVIDER_PRIORITY_LIST, bSlots);
    expect(await repo.get(StorageKeys.AI_PROVIDER_PRIORITY_LIST)).toEqual(bSlots);
    // layout自体は独立して保持される
    expect(await repo.get(StorageKeys.AI_PROVIDER_LAYOUT)).toBe('b');
  });
});
