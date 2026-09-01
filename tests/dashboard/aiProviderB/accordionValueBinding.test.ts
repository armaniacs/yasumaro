// @vitest-environment jsdom
/**
 * accordionValueBinding.test.ts
 * Regression for the B-layout bug where the "OpenAI互換 (Groq)" accordion body
 * showed empty placeholders while the saved openai_* values leaked into the A
 * layout's priority containers. The accordion owns its own #<id>Settings blocks;
 * loadSettingsToInputs must populate THOSE, and there must be no duplicate ids.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createBProviderAccordionView } from '../../../src/dashboard/aiProviderB/providerAccordionView.js';
import { loadSettingsToInputs } from '../../../src/utils/settingsFormBinding.js';
import { GENERAL_SETTINGS_SCHEMA } from '../../../src/utils/settingsSchemas.js';

function panel(): HTMLElement {
  document.body.innerHTML = `
    <section id="panel-general">
      <div id="providerSettingsMount"></div>
      <div id="bProviderAccordion"></div>
    </section>`;
  return document.getElementById('panel-general') as HTMLElement;
}

const SETTINGS = {
  openai_base_url: 'https://api.ai.sakura.ad.jp/v1',
  openai_api_key: 'sk-secret',
  openai_model: 'preview/gemma-4-31B-it',
  gemini_model: 'gemini-3.1-flash-lite',
};

describe('B accordion value binding', () => {
  beforeEach(() => { panel(); });

  it('loads openai_* values into the accordion body, not empty placeholders', () => {
    const accordion = document.getElementById('bProviderAccordion') as HTMLElement;
    createBProviderAccordionView(accordion);
    loadSettingsToInputs(accordion, SETTINGS, GENERAL_SETTINGS_SCHEMA);

    const baseUrl = accordion.querySelector('#openaiSettings input[data-storage-key="openai_base_url"]') as HTMLInputElement;
    const model = accordion.querySelector('#openaiSettings input[data-storage-key="openai_model"]') as HTMLInputElement;
    const apiKey = accordion.querySelector('#openaiSettings input[data-storage-key="openai_api_key"]') as HTMLInputElement;

    expect(baseUrl.value).toBe('https://api.ai.sakura.ad.jp/v1');
    expect(model.value).toBe('preview/gemma-4-31B-it');
    // password field: value cleared, "(Already set)" placeholder
    expect(apiKey.value).toBe('');
    expect(apiKey.placeholder).toContain('Already set');
  });

  it('does not create #openaiSettings twice (A mount stays empty in B)', () => {
    const accordion = document.getElementById('bProviderAccordion') as HTMLElement;
    createBProviderAccordionView(accordion);
    // The panel is responsible for keeping #providerSettingsMount empty in B;
    // assert the accordion is the only owner of the id.
    expect(document.querySelectorAll('#openaiSettings').length).toBe(1);
    expect(document.getElementById('providerSettingsMount')?.children.length).toBe(0);
  });

  it('openai-compatible (models-dev) body keeps its own provider_* fields separate from openai_*', () => {
    const accordion = document.getElementById('bProviderAccordion') as HTMLElement;
    createBProviderAccordionView(accordion);
    loadSettingsToInputs(accordion, SETTINGS, GENERAL_SETTINGS_SCHEMA);

    // The Sakura URL belongs to openai_base_url, NOT provider_base_url.
    const modelsDevBaseUrl = accordion.querySelector('#openai-compatibleSettings input[data-storage-key="provider_base_url"]') as HTMLInputElement;
    expect(modelsDevBaseUrl.value).toBe('');
  });
});
