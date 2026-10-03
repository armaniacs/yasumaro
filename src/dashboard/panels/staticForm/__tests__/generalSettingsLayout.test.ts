// @vitest-environment jsdom
/**
 * Unit tests for the A/B layout state machine module (PBI 2026-10-03-29):
 * the controller mounts independently of the panel — prepare() resolves the
 * initial layout and builds the A mount, wire() wires the listeners and the
 * toggle and runs the first refresh. The B view seeding, the A<-B rebuild,
 * and the toggle persistence must behave exactly as before the state
 * machine moved out of the mount closure.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { waitForMock } from '../../../../../testDir/waitPolicy.js';

const { mockGetAll, mockPortGet, mockSet } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockPortGet: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock('../../../../utils/storage/SettingsRepository.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    settingsRepository: {
      getAll: mockGetAll,
      set: mockSet,
      getPort: () => ({ get: mockPortGet }),
    },
  };
});

import { createAiProviderLayoutController } from '../generalSettingsLayout.js';
import { type Settings, StorageKeys } from '../../../../utils/storage/types.js';

const AI_SECTION = `
  <section id="panel-general" class="panel active">
    <div id="aiProviderSection" class="settings-section">
      <h3 class="settings-section-title">AI Provider</h3>
      <div id="bPrioritySection" hidden>
        <div id="bPriorityList"></div>
        <div id="bProviderAccordion"></div>
      </div>
      <details class="priority-details" open>
        <summary class="priority-details-summary">
          <span class="priority-provider-name" data-priority="1"></span>
        </summary>
        <div class="priority-details-content">
          <select id="aiProvider" data-storage-key="ai_provider"></select>
          <div id="priority1ProviderSettings"></div>
          <input type="text" id="aiProviderPriority1Model">
        </div>
      </details>
      <details class="priority-details">
        <div class="priority-details-content">
          <select id="aiProviderPriority2"></select>
          <div id="priority2ProviderSettings"></div>
        </div>
      </details>
      <details class="priority-details">
        <div class="priority-details-content">
          <select id="aiProviderPriority3"></select>
          <div id="priority3ProviderSettings"></div>
        </div>
      </details>
      <div id="providerSettingsMount"></div>
    </div>
  </section>`;

function toggleButton(layout: 'a' | 'b'): HTMLButtonElement {
  const group = document.querySelector('.ai-layout-toggle')!;
  return group.querySelectorAll<HTMLButtonElement>('button')[layout === 'b' ? 1 : 0]!;
}

describe('generalSettingsLayout — module independence', () => {
  beforeEach(() => {
    document.body.innerHTML = AI_SECTION;
    mockGetAll.mockReset();
    mockGetAll.mockResolvedValue({});
    mockSet.mockReset();
    mockSet.mockResolvedValue(undefined);
    mockPortGet.mockReset();
    mockPortGet.mockResolvedValue({ settings: { [StorageKeys.AI_PROVIDER_LAYOUT]: 'a' } });
  });

  it('prepare + wire mount standalone with layout a: the A mount is built and populated', async () => {
    mockGetAll.mockResolvedValue({
      [StorageKeys.AI_PROVIDER]: 'openai',
      [StorageKeys.OPENAI_BASE_URL]: 'https://a-layout.example/v1',
    });

    let settings: Settings = {};
    const controller = createAiProviderLayoutController({ container: document.getElementById('panel-general')!, getSettings: () => settings });

    await controller.prepare();
    expect(document.getElementById('providerSettingsMount')!.children.length).toBeGreaterThan(0);
    expect(document.getElementById('bPrioritySection')!.hidden).toBe(true);

    // The composition root applies the snapshot between prepare and wire.
    settings = await mockGetAll();
    controller.wire();

    const openai = document.getElementById('openaiSettings');
    expect(openai).not.toBeNull();
    const baseUrl = openai!.querySelector('input[data-storage-key="openai_base_url"]') as HTMLInputElement;
    expect(baseUrl.value).toBe('https://a-layout.example/v1');
  });

  it('prepare + wire mount standalone with layout b: the B views are built from the snapshot', async () => {
    mockPortGet.mockResolvedValue({ settings: { [StorageKeys.AI_PROVIDER_LAYOUT]: 'b' } });
    mockGetAll.mockResolvedValue({
      [StorageKeys.AI_PROVIDER]: 'openai',
      [StorageKeys.OPENAI_BASE_URL]: 'https://b-layout.example/v1',
      [StorageKeys.OPENAI_MODEL]: 'b-model',
      [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [{ provider: 'openai' }],
    });

    let settings: Settings = {};
    const controller = createAiProviderLayoutController({ container: document.getElementById('panel-general')!, getSettings: () => settings });

    await controller.prepare();
    // In B layout the A mount is not built at prepare time.
    expect(document.getElementById('providerSettingsMount')!.children.length).toBe(0);

    settings = await mockGetAll();
    controller.wire();

    const openaiBlocks = document.querySelectorAll('#openaiSettings');
    expect(openaiBlocks.length).toBe(1);
    expect(document.getElementById('bProviderAccordion')?.contains(openaiBlocks[0] ?? null)).toBe(true);
    const model = document.querySelector('#openaiSettings input[data-storage-key="openai_model"]') as HTMLInputElement;
    expect(model.value).toBe('b-model');
    expect(document.getElementById('bPrioritySection')!.hidden).toBe(false);
  });

  it('the B→A toggle persists the layout and rebuilds the A mount', async () => {
    mockPortGet.mockResolvedValue({ settings: { [StorageKeys.AI_PROVIDER_LAYOUT]: 'b' } });
    mockGetAll.mockResolvedValue({
      [StorageKeys.AI_PROVIDER_PRIORITY_LIST]: [{ provider: 'openai', model: 'toggled-model' }],
    });

    let settings: Settings = {};
    const controller = createAiProviderLayoutController({ container: document.getElementById('panel-general')!, getSettings: () => settings });
    await controller.prepare();
    settings = await mockGetAll();
    controller.wire();

    toggleButton('a').click();

    await waitForMock(() => {
      expect(document.getElementById('providerSettingsMount')!.children.length).toBeGreaterThan(0);
    });
    expect(mockSet).toHaveBeenCalledWith(StorageKeys.AI_PROVIDER_LAYOUT, 'a');
    expect(document.getElementById('bPrioritySection')!.hidden).toBe(true);
  });
});
