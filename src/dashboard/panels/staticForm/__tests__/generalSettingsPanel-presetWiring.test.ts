// @vitest-environment jsdom
/**
 * Parity for the general settings panel's provider preset button wiring
 * (PBI 2026-10-03-23): in layout A the panel mount builds the per-provider
 * settings blocks, so the preset buttons from the openai-compatible
 * (models-dev) block exist in the document. Clicking them must produce the
 * production handler behavior — preset URL into #providerBaseUrl plus the
 * dashboard status contract on #status and its one-shot #statusTop mirror —
 * so the data-driven wiring refactor cannot change what a click does.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createGeneralSettingsPanel } from '../generalSettingsPanel.js';
import { PROVIDER_DEFAULT_BASE_URLS } from '../../../../utils/storage/providerDefaultBaseUrls.js';
import { installTestSecretKek } from '../../../../utils/crypto/__tests__/secretKekHelper.js';

const PANEL_MARKUP = `
  <section id="panel-general" class="panel active">
    <div id="aiProviderSection" class="settings-section">
      <h3 class="settings-section-title">AI Provider</h3>
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
    <div id="status" class="status"></div>
    <div id="statusTop"></div>
  </section>`;

async function mountPanel(): Promise<void> {
  const panel = createGeneralSettingsPanel();
  await panel.mount(document.getElementById('panel-general')!);
}

beforeEach(async () => {
  await installTestSecretKek();
  document.body.innerHTML = PANEL_MARKUP;
  await chrome.storage.local.clear();
  await chrome.storage.session.clear();
  // Layout A: the A mount builds the #providerSettingsMount blocks, so the
  // preset buttons from the openai-compatible (models-dev) block exist.
  await chrome.storage.local.set({
    settings: {
      ai_provider: 'openai-compatible',
      ai_provider_layout: 'a',
    },
    settings_migrated: true,
  });
});

describe('generalSettingsPanel — provider preset button wiring', () => {
  it('wires the lmStudio preset button: click fills #providerBaseUrl with the preset URL', async () => {
    await mountPanel();

    const btn = document.getElementById('lmStudioPresetBtn');
    expect(btn).not.toBeNull();
    expect(btn?.tagName).toBe('BUTTON');
    (btn as HTMLButtonElement).click();

    const baseUrl = document.getElementById('providerBaseUrl') as HTMLInputElement;
    expect(baseUrl.value).toBe(PROVIDER_DEFAULT_BASE_URLS['lm-studio']);
  });

  it('writes the dashboard status contract to #status and mirrors #statusTop', async () => {
    await mountPanel();

    (document.getElementById('lmStudioPresetBtn') as HTMLButtonElement).click();

    const status = document.getElementById('status') as HTMLElement;
    const statusTop = document.getElementById('statusTop') as HTMLElement;
    expect(status.textContent).toContain('LM Studio preset applied');
    // Dashboard status contract (dashboard.css): status-message + type class.
    // The orphan .status-success only popup styles.css declares must never
    // appear.
    expect(status.className).toBe('status-message success');
    expect(status.classList.contains('status-success')).toBe(false);
    expect(statusTop.className).toBe('status-message success');
  });

  it('wires the ollama preset button with the same structure and behavior', async () => {
    await mountPanel();

    const btn = document.getElementById('ollamaPresetBtn');
    expect(btn).not.toBeNull();
    expect(btn?.tagName).toBe('BUTTON');
    (btn as HTMLButtonElement).click();

    const baseUrl = document.getElementById('providerBaseUrl') as HTMLInputElement;
    expect(baseUrl.value).toBe(PROVIDER_DEFAULT_BASE_URLS['ollama']);
    const status = document.getElementById('status') as HTMLElement;
    expect(status.textContent).toContain('Ollama preset applied');
    expect(status.className).toBe('status-message success');
    expect(status.classList.contains('status-success')).toBe(false);
  });
});
