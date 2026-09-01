/**
 * aiProviderCatalogView.ts
 * Catalog-driven builders for the options-page AI provider UI.
 *
 * Both layouts (A: unified, B: per-provider accordion) call these instead of
 * hand-maintaining `<option>` groups, per-provider `<div>`s, and visibility
 * if-chains. Adding a provider = one PROVIDER_REGISTRY row + i18n keys.
 *
 * Element ids and data-* attributes match the former static markup in
 * entrypoints/options/index.html exactly, so existing binding
 * (settingsFormBinding, fieldValidation, preset/models-dev handlers) is
 * untouched. Every builder calls applyI18n() on its subtree because the
 * page-level applyI18n ran at load, before these nodes existed.
 */

import { PROVIDER_CATALOG, type ProviderCatalogEntry } from '../background/ai/providerCatalog.js';
import type { ProviderId } from '../utils/storage/types.js';
import { getMessage } from '../utils/i18n.js';
import { applyI18n } from '../utils/i18n-dom.js';

/** storage key → the input element id the former static markup used. */
const KEY_TO_INPUT_ID: Record<string, string> = {
  gemini_api_key: 'geminiApiKey',
  gemini_model: 'geminiModel',
  openai_base_url: 'openaiBaseUrl',
  openai_api_key: 'openaiApiKey',
  openai_model: 'openaiModel',
  openai_2_base_url: 'openai2BaseUrl',
  openai_2_api_key: 'openai2ApiKey',
  openai_2_model: 'openai2Model',
  lm_studio_base_url: 'lmStudioBaseUrl',
  lm_studio_model: 'lmStudioModel',
  ollama_base_url: 'ollamaBaseUrl',
  ollama_model: 'ollamaModel',
  provider_base_url: 'providerBaseUrl',
  provider_api_key: 'providerApiKey',
  provider_model: 'providerModel',
};

export function providerIdsInOrder(): ProviderId[] {
  return [...PROVIDER_CATALOG.keys()];
}

export interface RenderOptionsConfig {
  /** Prepend `<option value="">` (Not set). */
  includeNone?: boolean;
  /** Only entries with supportsCustomPrompt, and prepend `<option value="all">`. */
  customPrompt?: boolean;
}

/**
 * Rebuild a provider `<select>`'s `<option>` list from the catalog, preserving
 * the current value when the option still exists.
 */
export function renderProviderOptions(sel: HTMLSelectElement, cfg: RenderOptionsConfig = {}): void {
  const prev = sel.value;
  sel.textContent = '';

  if (cfg.customPrompt) {
    sel.appendChild(makeOption('all', getMessage('promptProviderAll') || 'All Providers'));
  } else if (cfg.includeNone) {
    sel.appendChild(makeOption('', getMessage('providerPriorityNone') || 'Not set'));
  }

  for (const [id, entry] of PROVIDER_CATALOG) {
    if (cfg.customPrompt && !entry.supportsCustomPrompt) continue;
    sel.appendChild(makeOption(id, getMessage(entry.labelI18nKey) || entry.label));
  }

  if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

/**
 * Render one provider's settings form into `container`. Sets
 * `container.id = "<providerId>Settings"` to match the former markup.
 */
export function renderProviderSettings(container: HTMLElement, providerId: ProviderId): void {
  const entry = PROVIDER_CATALOG.get(providerId);
  if (!entry) return;

  container.textContent = '';
  container.id = `${providerId}Settings`;
  if (providerId !== 'gemini') container.classList.add('openai-settings');

  switch (entry.settingsBlockKind) {
    case 'built-in-ai':
      container.appendChild(helpText('builtInAiHelp'));
      break;
    case 'models-dev':
      buildModelsDevBlock(container, entry);
      break;
    default:
      buildGenericBlock(container, entry, providerId);
  }

  applyI18n(container);
}

// ---------------------------------------------------------------------------

function makeOption(value: string, text: string): HTMLOptionElement {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  return o;
}

function formGroup(...children: HTMLElement[]): HTMLDivElement {
  const g = document.createElement('div');
  g.className = 'form-group';
  g.append(...children);
  return g;
}

function label(forId: string, i18nKey: string): HTMLLabelElement {
  const l = document.createElement('label');
  l.htmlFor = forId;
  l.setAttribute('data-i18n', i18nKey);
  return l;
}

function input(opts: {
  id: string;
  type: 'text' | 'password';
  storageKey: string;
  placeholderKey?: string | undefined;
}): HTMLInputElement {
  const el = document.createElement('input');
  el.type = opts.type;
  el.id = opts.id;
  el.setAttribute('data-storage-key', opts.storageKey);
  if (opts.placeholderKey) el.setAttribute('data-i18n-input-placeholder', opts.placeholderKey);
  return el;
}

function helpText(i18nKey: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'help-text';
  p.setAttribute('data-i18n', i18nKey);
  return p;
}

function buildGenericBlock(container: HTMLElement, entry: ProviderCatalogEntry, providerId: ProviderId): void {
  if (entry.baseUrlKey) {
    const id = KEY_TO_INPUT_ID[entry.baseUrlKey] ?? entry.baseUrlKey;
    container.appendChild(formGroup(
      label(id, 'baseUrl'),
      input({ id, type: 'text', storageKey: entry.baseUrlKey, placeholderKey: entry.fieldPlaceholders?.baseUrl }),
    ));
  }
  if (entry.apiKeyKey && entry.requiresApiKey) {
    const id = KEY_TO_INPUT_ID[entry.apiKeyKey] ?? entry.apiKeyKey;
    // gemini uses its own label key; the rest use the shared "aiApiKey"
    const labelKey = providerId === 'gemini' ? 'geminiApiKey' : 'aiApiKey';
    container.appendChild(formGroup(
      label(id, labelKey),
      input({ id, type: 'password', storageKey: entry.apiKeyKey, placeholderKey: entry.fieldPlaceholders?.apiKey }),
    ));
  }
  if (entry.modelKey) {
    const id = KEY_TO_INPUT_ID[entry.modelKey] ?? entry.modelKey;
    container.appendChild(formGroup(
      label(id, 'modelName'),
      input({ id, type: 'text', storageKey: entry.modelKey, placeholderKey: entry.fieldPlaceholders?.model }),
    ));
  }

  if (providerId === 'gemini') {
    const versionInput = input({ id: 'geminiApiVersion', type: 'text', storageKey: 'gemini_api_version' });
    versionInput.placeholder = 'v1beta';
    versionInput.setAttribute('aria-invalid', 'false');
    versionInput.setAttribute('aria-describedby', 'geminiApiVersionNote geminiApiVersionError');
    const note = helpText('note_gemini_api_version');
    note.id = 'geminiApiVersionNote';
    const err = document.createElement('div');
    err.id = 'geminiApiVersionError';
    err.className = 'field-error';
    err.setAttribute('role', 'alert');
    container.appendChild(formGroup(label('geminiApiVersion', 'label_gemini_api_version'), versionInput, note, err));
  }
}

function buildModelsDevBlock(container: HTMLElement, entry: ProviderCatalogEntry): void {
  // Description + "Select Provider" button
  const descLabel = document.createElement('label');
  descLabel.setAttribute('data-i18n', 'modelsDevDescription');
  const selectBtn = document.createElement('button');
  selectBtn.type = 'button';
  selectBtn.id = 'openModelsDevDialogBtn';
  selectBtn.className = 'secondary-btn';
  selectBtn.setAttribute('data-i18n', 'selectProvider');
  container.appendChild(formGroup(descLabel, selectBtn));

  // Selected provider info (hidden until a provider is picked)
  const info = document.createElement('div');
  info.id = 'selectedProviderInfo';
  info.className = 'selected-provider-info hidden';
  const infoLabel = document.createElement('label');
  infoLabel.setAttribute('data-i18n', 'selectedProviderInfo');
  const infoDisplay = document.createElement('div');
  infoDisplay.id = 'providerInfoDisplay';
  infoDisplay.className = 'provider-display';
  info.append(infoLabel, infoDisplay);
  container.appendChild(info);

  // Base URL + presets
  const baseUrlKey = entry.baseUrlKey ?? 'provider_base_url';
  const baseInput = input({ id: 'providerBaseUrl', type: 'text', storageKey: baseUrlKey, placeholderKey: entry.fieldPlaceholders?.baseUrl });
  const lmBtn = presetButton('lmStudioPresetBtn', 'lmStudioPreset');
  const ollamaBtn = presetButton('ollamaPresetBtn', 'ollamaPreset');
  container.appendChild(formGroup(label('providerBaseUrl', 'baseUrl'), baseInput, lmBtn, ollamaBtn));

  // API key
  if (entry.apiKeyKey) {
    container.appendChild(formGroup(
      label('providerApiKey', 'apiKey'),
      input({ id: 'providerApiKey', type: 'password', storageKey: entry.apiKeyKey, placeholderKey: entry.fieldPlaceholders?.apiKey }),
    ));
  }

  // Model (optional)
  if (entry.modelKey) {
    container.appendChild(formGroup(
      label('providerModel', 'modelName'),
      input({ id: 'providerModel', type: 'text', storageKey: entry.modelKey, placeholderKey: entry.fieldPlaceholders?.model }),
    ));
  }
}

function presetButton(id: string, i18nKey: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = id;
  b.className = 'small-btn';
  b.setAttribute('data-i18n', i18nKey);
  return b;
}
