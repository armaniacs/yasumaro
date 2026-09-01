// @vitest-environment jsdom
/**
 * generalSettingsPanel-bLayout.test.ts
 * Regression for the B-layout provider-settings bug (2026-09-02):
 * with AI_PROVIDER_LAYOUT='b', mount() built the A #providerSettingsMount blocks
 * AND the B accordion — duplicate #<id>Settings ids. loadSettingsToInputs then
 * populated the A blocks (which updateProviderSettingsLayout un-hid and moved
 * into the priority containers), while the accordion showed empty placeholders.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createGeneralSettingsPanel } from '../generalSettingsPanel.js';

const AI_SECTION = `
  <section id="panel-general" class="panel active">
    <div id="aiProviderSection" class="settings-section">
      <h3 class="settings-section-title">AI Provider</h3>
      <div id="bPrioritySection" hidden>
        <div id="bPriorityList"></div>
        <div id="bProviderAccordion"></div>
      </div>
      <details class="priority-details" open>
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
          <input type="text" id="aiProviderPriority2Model">
        </div>
      </details>
      <details class="priority-details">
        <div class="priority-details-content">
          <select id="aiProviderPriority3"></select>
          <div id="priority3ProviderSettings"></div>
          <input type="text" id="aiProviderPriority3Model">
        </div>
      </details>
      <div id="providerSettingsMount"></div>
    </div>
  </section>`;

async function seedSettings(extra: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  await chrome.storage.local.set({
    settings: {
      ai_provider: 'openai',
      ai_provider_priority_list: [{ provider: 'openai' }],
      openai_base_url: 'https://api.ai.sakura.ad.jp/v1',
      openai_api_key: 'sk-secret',
      openai_model: 'preview/gemma-4-31B-it',
      ...extra,
    },
    settings_migrated: true,
  });
}

describe('generalSettingsPanel — B layout provider settings', () => {
  beforeEach(() => {
    document.body.innerHTML = AI_SECTION;
  });

  it('B layout: openai_* values land in the accordion, not the priority container', async () => {
    await seedSettings({ ai_provider_layout: 'b' });

    const panel = createGeneralSettingsPanel();
    await panel.mount(document.getElementById('panel-general')!);

    // Exactly one #openaiSettings, inside the accordion
    const openaiBlocks = document.querySelectorAll('#openaiSettings');
    expect(openaiBlocks.length).toBe(1);
    expect(document.getElementById('bProviderAccordion')?.contains(openaiBlocks[0])).toBe(true);

    // A mount stays empty in B
    expect(document.getElementById('providerSettingsMount')?.children.length).toBe(0);
    // Priority container not populated with a provider block
    expect(document.getElementById('priority1ProviderSettings')?.querySelector('#openaiSettings')).toBeNull();

    // Accordion fields carry the saved values
    const baseUrl = document.querySelector('#openaiSettings input[data-storage-key="openai_base_url"]') as HTMLInputElement;
    const model = document.querySelector('#openaiSettings input[data-storage-key="openai_model"]') as HTMLInputElement;
    expect(baseUrl.value).toBe('https://api.ai.sakura.ad.jp/v1');
    expect(model.value).toBe('preview/gemma-4-31B-it');
  });

  it('A layout: #providerSettingsMount is built and populated', async () => {
    await seedSettings({ ai_provider_layout: 'a' });

    const panel = createGeneralSettingsPanel();
    await panel.mount(document.getElementById('panel-general')!);

    const mount = document.getElementById('providerSettingsMount')!;
    expect(mount.children.length).toBeGreaterThan(0);
    // openaiSettings gets moved into priority1 by updateProviderSettingsLayout
    const openai = document.getElementById('openaiSettings');
    expect(openai).not.toBeNull();
    const baseUrl = openai!.querySelector('input[data-storage-key="openai_base_url"]') as HTMLInputElement;
    expect(baseUrl.value).toBe('https://api.ai.sakura.ad.jp/v1');
  });
});
