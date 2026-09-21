/**
 * @vitest-environment jsdom
 * aiProviderCatalogView.catalog-driven.test.ts (PBI 2026-09-21-14)
 * Proves the views render provider variants from catalog fields alone: a
 * fixture entry with custom fields renders accordingly with no view change.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PROVIDER_CATALOG, type ProviderCatalogEntry } from '../../background/ai/providerCatalog.js';
import type { ProviderId } from '../../utils/storage/types.js';
import { renderProviderSettings } from '../aiProviderCatalogView.js';
import { createBProviderAccordionView } from '../aiProviderB/providerAccordionView.js';

const FIXTURE_ID = '__catalog_fixture__' as ProviderId;

const FIXTURE_ENTRY: ProviderCatalogEntry = {
  baseUrlKey: 'fixture_base_url',
  apiKeyKey: 'fixture_api_key',
  modelKey: 'fixture_model',
  requiresApiKey: true,
  isLocal: false,
  label: 'Fixture',
  labelI18nKey: 'openaiCompatible',
  supportsCustomPrompt: false,
  settingsBlockKind: 'generic',
  apiKeyLabelI18nKey: 'aiApiKey',
  cssClass: 'fixture-settings',
  defaultOpen: true,
  extraFields: [
    {
      storageKey: 'fixture_extra',
      inputId: 'fixtureExtra',
      type: 'text',
      labelI18nKey: 'modelName',
      a11y: {
        describedBy: 'fixtureNote fixtureError',
        noteId: 'fixtureNote',
        noteI18nKey: 'modelName',
        errorId: 'fixtureError',
      },
    },
  ],
};

describe('catalog-driven provider UI', () => {
  afterEach(() => {
    PROVIDER_CATALOG.delete(FIXTURE_ID);
    document.body.innerHTML = '';
  });

  it('gemini catalog values encode the former branches', () => {
    const gemini = PROVIDER_CATALOG.get('gemini' as ProviderId);
    expect(gemini?.apiKeyLabelI18nKey).toBe('geminiApiKey');
    expect(gemini?.cssClass).toBe('');
    expect(gemini?.defaultOpen).toBe(true);
    expect(gemini?.extraFields?.[0]?.a11y).toEqual({
      describedBy: 'geminiApiVersionNote geminiApiVersionError',
      noteId: 'geminiApiVersionNote',
      noteI18nKey: 'note_gemini_api_version',
      errorId: 'geminiApiVersionError',
    });
  });

  it('non-gemini entries rely on view defaults (no per-provider values)', () => {
    for (const [id, entry] of PROVIDER_CATALOG) {
      if (id === 'gemini') continue;
      expect(entry.apiKeyLabelI18nKey).toBeUndefined();
      expect(entry.cssClass).toBeUndefined();
      expect(entry.defaultOpen ?? false).toBe(false);
      for (const field of entry.extraFields ?? []) {
        expect(field.a11y, `${id}:${field.storageKey}`).toBeUndefined();
      }
    }
  });

  it('a fixture entry renders css class, label key, a11y block, and open state from fields alone', () => {
    PROVIDER_CATALOG.set(FIXTURE_ID, FIXTURE_ENTRY);

    const c = document.createElement('div');
    document.body.appendChild(c);
    renderProviderSettings(c, FIXTURE_ID);
    expect(c.id).toBe(`${FIXTURE_ID}Settings`);
    expect(c.classList.contains('fixture-settings')).toBe(true);
    const apiKeyLabel = [...c.querySelectorAll('label')].find(
      (l) => l.htmlFor === 'fixtureApiKey',
    );
    expect(apiKeyLabel?.getAttribute('data-i18n')).toBe('aiApiKey');
    const extra = c.querySelector('#fixtureExtra');
    expect(extra?.getAttribute('aria-describedby')).toBe('fixtureNote fixtureError');
    expect(c.querySelector('#fixtureNote')).not.toBeNull();
    expect(c.querySelector('#fixtureError')?.getAttribute('role')).toBe('alert');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const view = createBProviderAccordionView(container);
    const fixtureDetails = container.querySelector(
      `details[data-provider="${FIXTURE_ID}Settings"]`,
    ) as HTMLDetailsElement;
    expect(fixtureDetails.open).toBe(true);
    view.destroy();
    c.remove();
    container.remove();
  });

  it('default resolution matches legacy behavior (class present, aiApiKey, closed)', () => {
    PROVIDER_CATALOG.set(FIXTURE_ID, { ...FIXTURE_ENTRY, cssClass: undefined, apiKeyLabelI18nKey: undefined, defaultOpen: undefined, extraFields: undefined });
    const c = document.createElement('div');
    document.body.appendChild(c);
    renderProviderSettings(c, FIXTURE_ID);
    expect(c.classList.contains('openai-settings')).toBe(true);
    const apiKeyLabel = [...c.querySelectorAll('label')].find((l) => l.htmlFor === 'fixtureApiKey');
    expect(apiKeyLabel?.getAttribute('data-i18n')).toBe('aiApiKey');
    expect(c.querySelector('[aria-describedby]')).toBeNull();
    c.remove();
  });
});
